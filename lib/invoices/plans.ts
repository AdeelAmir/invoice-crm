import { prisma } from "@/lib/db";
import { logStep } from "@/lib/invoices/audit";
import { createInvoice } from "@/lib/invoices/create";
import { adminSetStatus, generateNow } from "@/lib/invoices/service";
import { wallTimeIn, zonedTimeToUtc } from "@/lib/timezone";
import type { BillingPlanType } from "@/lib/generated/prisma/enums";

// The client's billing plan, set on the client form, drives invoicing:
//   ONE_TIME - one invoice on the chosen date;
//   MONTHLY  - an invoice on the chosen date, then on the same day every
//              month (the recurring rule generates each next one).
// A date of today is processed at once (the agent emails it within
// moments); a later date waits as PENDING and the worker's schedule
// processes it on that day. Changing the plan stops the old schedule and
// starts the new one; invoices already sent are not touched.

export type BillingPlan = {
  type: BillingPlanType;
  description: string | null;
  amount: string | null; // dollars, 2 decimals, before tax
  date: string | null; // YYYY-MM-DD in the client's timezone
  termsDays: number | null;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Today's date (YYYY-MM-DD) in a timezone. */
export function todayIn(timeZone: string, now = new Date()): string {
  const w = wallTimeIn(now, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Today or earlier: now. A later date: 09:00 that day in the client's timezone. */
export function issueAtFor(date: string, timeZone: string, now = new Date()): Date {
  if (date <= todayIn(timeZone, now)) return now;
  const [year, month, day] = date.split("-").map(Number);
  return zonedTimeToUtc({ year, month, day, hour: 9, minute: 0, second: 0 }, timeZone);
}

/** @db.Date column <-> YYYY-MM-DD. */
export const dateToColumn = (date: string) => new Date(`${date}T00:00:00Z`);
export const columnToDate = (d: Date) => d.toISOString().slice(0, 10);

export function planOf(client: {
  billingType: BillingPlanType;
  billingDescription: string | null;
  billingAmount: { toString(): string } | null;
  billingDate: Date | null;
  billingTermsDays: number | null;
}): BillingPlan {
  if (client.billingType === "NONE") return { type: "NONE", description: null, amount: null, date: null, termsDays: null };
  return {
    type: client.billingType,
    description: client.billingDescription,
    amount: client.billingAmount ? Number(client.billingAmount.toString()).toFixed(2) : null,
    date: client.billingDate ? columnToDate(client.billingDate) : null,
    termsDays: client.billingTermsDays,
  };
}

export function samePlan(a: BillingPlan, b: BillingPlan): boolean {
  return a.type === b.type && a.description === b.description && a.amount === b.amount && a.date === b.date && a.termsDays === b.termsDays;
}

/** Schedules the first invoice of the client's current plan. */
export async function startClientPlan(clientId: number, actor: string): Promise<{ invoiceId: number | null; processedNow: boolean }> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const plan = planOf(client);
  if (plan.type === "NONE" || !plan.description || !plan.amount || !plan.date) return { invoiceId: null, processedNow: false };

  const now = new Date();
  const issueAt = issueAtFor(plan.date, client.timezone, now);
  const result = await createInvoice(
    {
      clientId,
      lineItems: [{ description: plan.description, quantity: 1, unitPrice: Number(plan.amount) }],
      issueAt,
      termsDays: plan.termsDays ?? 15,
      recurring: plan.type === "MONTHLY" ? { frequency: "MONTHLY", occurrenceCount: null, endDate: null } : undefined,
      fromClientPlan: true,
    },
    actor,
  );
  if (!result.ok) throw new Error(`Could not schedule the client's invoice: ${result.error}`);

  const processedNow = issueAt <= now;
  if (processedNow) await generateNow(result.invoice.id, actor);
  return { invoiceId: result.invoice.id, processedNow };
}

/** Stops the client's plan schedule: no further monthly invoices, and plan invoices not yet issued are cancelled. */
export async function stopClientPlan(clientId: number, actor: string): Promise<{ cancelled: number }> {
  await prisma.recurringRule.updateMany({
    where: { clientId, fromClientPlan: true, stoppedAt: null },
    data: { stoppedAt: new Date() },
  });
  const pending = await prisma.invoice.findMany({
    where: { clientId, fromClientPlan: true, status: "PENDING" },
    select: { id: true },
  });
  let cancelled = 0;
  for (const inv of pending) {
    const r = await adminSetStatus(inv.id, "CANCELLED", actor);
    if (r.ok) {
      cancelled++;
      await logStep({
        invoiceId: inv.id,
        step: "MANUAL_STATUS",
        result: "SUCCESS",
        message: "Billing plan changed: this scheduled invoice was cancelled",
        actor,
      });
    }
  }
  return { cancelled };
}
