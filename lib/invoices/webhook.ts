import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { logStep } from "@/lib/invoices/audit";
import { enqueueTask, taskKeys } from "@/lib/agent/tasks";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { InvoiceStatus } from "@/lib/generated/prisma/enums";

// Payment webhooks (POST /api/webhooks/payment). The sender signs the raw
// body with HMAC-SHA256 and the shared PAYMENT_WEBHOOK_SECRET:
//   x-webhook-signature: sha256=<hex digest>
// Each event id is stored, so a repeated delivery changes nothing.

export function signPayload(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  const provided = header?.match(/^sha256=([0-9a-f]{64})$/i)?.[1];
  if (!provided) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(Buffer.from(provided, "hex"), expected);
}

export type PaymentEvent = {
  id: string;
  type: "invoice.paid" | "invoice.payment_failed";
  data: { invoiceId?: number; gatewayInvoiceId?: string; reason?: string };
};

export type PaymentEventResult =
  | { found: false }
  | { found: true; duplicate: boolean; invoiceId: number; changed: boolean; status: InvoiceStatus };

const PAYABLE: InvoiceStatus[] = ["CREATED", "SENT"];

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export async function handlePaymentEvent(event: PaymentEvent, actor = "webhook"): Promise<PaymentEventResult> {
  const invoice = await prisma.invoice.findFirst({
    where: event.data.invoiceId ? { id: event.data.invoiceId } : { gatewayInvoiceId: event.data.gatewayInvoiceId },
    select: { id: true, status: true },
  });
  if (!invoice) return { found: false };

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.create({
        data: {
          eventId: event.id,
          type: event.type,
          invoiceId: invoice.id,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });

      if (event.type === "invoice.payment_failed") {
        await logStep(
          {
            invoiceId: invoice.id,
            step: "PAYMENT_WEBHOOK",
            result: "FAILURE",
            message: `Payment failed${event.data.reason ? `: ${event.data.reason}` : ""} (event ${event.id})`,
            actor,
          },
          tx,
        );
        return { found: true, duplicate: false, invoiceId: invoice.id, changed: false, status: invoice.status };
      }

      const { count } = await tx.invoice.updateMany({
        where: { id: invoice.id, status: { in: PAYABLE } },
        data: { status: "PAID", paidAt: new Date(), nextRetryAt: null },
      });
      const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } });
      if (count === 1) {
        // The agent writes and sends the receipt.
        await enqueueTask({ type: "RECEIPT_EMAIL", invoiceId: invoice.id, dedupeKey: taskKeys.receipt(invoice.id) }, tx);
      }
      await logStep(
        {
          invoiceId: invoice.id,
          step: "PAYMENT_WEBHOOK",
          // A payment for a cancelled or unprocessed invoice needs a look.
          result: count === 1 || current.status === "PAID" ? "SUCCESS" : "FAILURE",
          message:
            count === 1
              ? `Payment received: ${invoice.status} → PAID (event ${event.id})`
              : current.status === "PAID"
                ? `Payment received for an invoice already PAID (event ${event.id})`
                : `Payment received but the invoice is ${current.status}: check it by hand (event ${event.id})`,
          actor,
        },
        tx,
      );
      return { found: true, duplicate: false, invoiceId: invoice.id, changed: count === 1, status: current.status };
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const current = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } });
    return { found: true, duplicate: true, invoiceId: invoice.id, changed: false, status: current.status };
  }
}
