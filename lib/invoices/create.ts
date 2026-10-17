import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { computeTotals, taxLinesFor } from "@/lib/tax";
import { fromCents } from "@/lib/money";
import { logStep } from "@/lib/invoices/audit";
import { invoiceNumberFor } from "@/lib/invoices/processor";
import type { Invoice } from "@/lib/generated/prisma/client";
import type { RecurrenceFrequency, SimulatedFailure } from "@/lib/generated/prisma/enums";

// Adds a PENDING invoice (and, for a recurring one, its schedule). The
// normal processing flow picks it up once issueAt has passed; a recurring
// invoice generates its next occurrence when it is CREATED.

const DAY = 24 * 60 * 60 * 1000;

export type NewInvoice = {
  clientId: number;
  lineItems: { description: string; quantity: number; unitPrice: number }[];
  issueAt: Date;
  termsDays: number;
  recurring?: { frequency: RecurrenceFrequency; occurrenceCount?: number | null; endDate?: Date | null };
  simulateFailure?: SimulatedFailure;
  /** Generated from the client's billing plan (replaced when the plan changes). */
  fromClientPlan?: boolean;
};

export type CreateResult = { ok: true; invoice: Invoice } | { ok: false; error: string };

export async function createInvoice(input: NewInvoice, actor: string): Promise<CreateResult> {
  const client = await prisma.client.findUnique({ where: { id: input.clientId } });
  if (!client) return { ok: false, error: "Client not found" };
  if (!client.isActive) return { ok: false, error: "Client is deactivated" };

  const lines = input.lineItems.map((l) => ({ ...l, unitPriceCents: Math.round(l.unitPrice * 100) }));
  const totals = computeTotals(lines, taxLinesFor(client.country, client.province));

  const invoice = await prisma.$transaction(async (tx) => {
    const rule = input.recurring
      ? await tx.recurringRule.create({
          data: {
            clientId: client.id,
            frequency: input.recurring.frequency,
            startDate: input.issueAt,
            endDate: input.recurring.endDate ?? null,
            occurrenceCount: input.recurring.occurrenceCount ?? null,
            generatedCount: 1, // this first invoice
            fromClientPlan: input.fromClientPlan ?? false,
          },
        })
      : null;
    const created = await tx.invoice.create({
      data: {
        invoiceNumber: `TMP-${randomUUID()}`,
        clientId: client.id,
        currency: client.country === "US" ? "USD" : "CAD",
        subtotal: fromCents(totals.subtotalCents),
        taxTotal: fromCents(totals.taxTotalCents),
        total: fromCents(totals.totalCents),
        issueAt: input.issueAt,
        dueAt: new Date(input.issueAt.getTime() + input.termsDays * DAY),
        paymentTerms: `Net ${input.termsDays}`,
        type: rule ? "RECURRING" : "ONE_TIME",
        simulateFailure: input.simulateFailure ?? "NONE",
        recurringRuleId: rule?.id ?? null,
        fromClientPlan: input.fromClientPlan ?? false,
        lineItems: {
          create: lines.map((l, i) => ({
            description: l.description,
            quantity: l.quantity.toFixed(2),
            unitPrice: fromCents(l.unitPriceCents),
            lineTotal: fromCents(totals.lines[i].lineTotalCents),
            position: i,
          })),
        },
        taxes: {
          create: totals.taxes.map((t) => ({
            name: t.name,
            rate: String(t.ratePercent),
            amount: fromCents(t.amountCents),
          })),
        },
      },
    });
    const numbered = await tx.invoice.update({
      where: { id: created.id },
      data: { invoiceNumber: invoiceNumberFor(created.id) },
    });
    await logStep(
      {
        invoiceId: created.id,
        step: "INVOICE_CREATE",
        result: "SUCCESS",
        message: rule
          ? `Recurring invoice added (${rule.frequency.toLowerCase()}), total ${fromCents(totals.totalCents)} ${numbered.currency}`
          : `One-time invoice added, total ${fromCents(totals.totalCents)} ${numbered.currency}`,
        actor,
      },
      tx,
    );
    return numbered;
  });
  return { ok: true, invoice };
}
