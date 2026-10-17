import { NextResponse } from "next/server";
import { toCents, fromCents } from "@/lib/money";
import { prisma } from "@/lib/db";
import type { ProcessOutcome } from "@/lib/invoices/processor";

// Shared helpers for the /api/invoices routes.

export function parseInvoiceId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function badRequest(error: string, details?: unknown) {
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status: 400 });
}

export function notFoundJson() {
  return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
}

type DecimalLike = { toString(): string };

// JSON shape of an invoice: money as fixed 2-decimal strings, dates in UTC ISO.
export function serializeInvoice(invoice: {
  id: number;
  invoiceNumber: string;
  clientId: number;
  currency: string;
  subtotal: DecimalLike;
  taxTotal: DecimalLike;
  total: DecimalLike;
  issueAt: Date;
  dueAt: Date;
  paymentTerms: string;
  type: string;
  status: string;
  retryCount: number;
  lastError: string | null;
  errorType: string | null;
  nextRetryAt: Date | null;
  gatewayInvoiceId: string | null;
  recurringRuleId: number | null;
  sentAt: Date | null;
  paidAt: Date | null;
  reminderCount: number;
  lastReminderAt: Date | null;
  client?: { id: number; name: string; email: string; phone: string; timezone: string; preferredChannel: string; smsConsent: boolean };
  lineItems?: { description: string; quantity: DecimalLike; unitPrice: DecimalLike; lineTotal: DecimalLike }[];
  taxes?: { name: string; rate: DecimalLike; amount: DecimalLike }[];
}) {
  const money = (v: DecimalLike) => fromCents(toCents(v));
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    clientId: invoice.clientId,
    currency: invoice.currency,
    subtotal: money(invoice.subtotal),
    taxTotal: money(invoice.taxTotal),
    total: money(invoice.total),
    issueAt: invoice.issueAt.toISOString(),
    dueAt: invoice.dueAt.toISOString(),
    paymentTerms: invoice.paymentTerms,
    type: invoice.type,
    status: invoice.status,
    retryCount: invoice.retryCount,
    lastError: invoice.lastError,
    errorType: invoice.errorType,
    nextRetryAt: invoice.nextRetryAt?.toISOString() ?? null,
    gatewayInvoiceId: invoice.gatewayInvoiceId,
    recurringRuleId: invoice.recurringRuleId,
    sentAt: invoice.sentAt?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    reminderCount: invoice.reminderCount,
    lastReminderAt: invoice.lastReminderAt?.toISOString() ?? null,
    ...(invoice.client
      ? {
          client: {
            id: invoice.client.id,
            name: invoice.client.name,
            email: invoice.client.email,
            phone: invoice.client.phone,
            timezone: invoice.client.timezone,
            preferredChannel: invoice.client.preferredChannel,
            smsConsent: invoice.client.smsConsent,
          },
        }
      : {}),
    ...(invoice.lineItems
      ? {
          lineItems: invoice.lineItems.map((l) => ({
            description: l.description,
            quantity: l.quantity.toString(),
            unitPrice: money(l.unitPrice),
            lineTotal: money(l.lineTotal),
          })),
        }
      : {}),
    ...(invoice.taxes
      ? { taxes: invoice.taxes.map((t) => ({ name: t.name, rate: t.rate.toString(), amount: money(t.amount) })) }
      : {}),
  };
}

// Response for /process and /retry: the outcome plus the invoice as it is
// now. A run that did not start (not pending, retry limit, ...) is a 409.
export async function processResponse(invoiceId: number, result: ProcessOutcome) {
  if (result.outcome === "skipped" && result.reason === "Invoice not found") return notFoundJson();
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { client: true, lineItems: true, taxes: true },
  });
  return NextResponse.json(
    { ...result, invoice: serializeInvoice(invoice) },
    { status: result.outcome === "skipped" ? 409 : 200 },
  );
}
