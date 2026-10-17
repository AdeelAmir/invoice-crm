import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { invoiceConfig } from "@/lib/config";
import { fromCents } from "@/lib/money";

// Stand-in for a real payment gateway (Stripe, Moneris, ...). It keeps the
// one property the flow depends on: creating an invoice is idempotent on
// the key, so a retry after a crash never bills the client twice.

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export type CreateGatewayInvoiceInput = {
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  simulateTimeout?: boolean;
};

export type GatewayInvoice = { gatewayId: string; replayed: boolean };

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export async function createGatewayInvoice(
  input: CreateGatewayInvoiceInput,
): Promise<GatewayInvoice> {
  const { gatewayLatencyMs } = invoiceConfig();
  if (gatewayLatencyMs > 0) await new Promise((r) => setTimeout(r, gatewayLatencyMs));

  if (input.simulateTimeout) {
    throw new GatewayError("Payment gateway timed out (simulated)", true, "TIMEOUT");
  }

  const existing = await prisma.mockGatewayInvoice.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return { gatewayId: existing.gatewayId, replayed: true };

  try {
    const created = await prisma.mockGatewayInvoice.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        gatewayId: `gw_in_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        amount: fromCents(input.amountCents),
        currency: input.currency,
      },
    });
    return { gatewayId: created.gatewayId, replayed: false };
  } catch (err) {
    // Two calls raced on the same key: the other one won, return its result.
    if (isUniqueViolation(err)) {
      const winner = await prisma.mockGatewayInvoice.findUniqueOrThrow({
        where: { idempotencyKey: input.idempotencyKey },
      });
      return { gatewayId: winner.gatewayId, replayed: true };
    }
    throw err;
  }
}
