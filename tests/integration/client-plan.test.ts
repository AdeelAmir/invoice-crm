import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "@/lib/db";
import { processInvoice } from "@/lib/invoices/processor";
import { dateToColumn, issueAtFor, startClientPlan, stopClientPlan, todayIn } from "@/lib/invoices/plans";
import { billingSchema } from "@/lib/validation/client";
import { wallTimeIn } from "@/lib/timezone";
import type { BillingPlanType } from "@/lib/generated/prisma/enums";

// The client's billing plan drives invoicing: one-time on a date, or
// monthly from a date; changing the plan replaces the schedule.

const TZ = "America/Toronto";
const DAY = 86_400_000;

async function wipe() {
  await prisma.auditLog.deleteMany();
  await prisma.invoice.updateMany({ data: { parentInvoiceId: null } });
  await prisma.invoice.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.client.deleteMany();
  await prisma.mockGatewayInvoice.deleteMany();
}

function dateIn(days: number) {
  return todayIn(TZ, new Date(Date.now() + days * DAY));
}

async function clientWithPlan(type: BillingPlanType, date: string, amount = "650.00") {
  return prisma.client.create({
    data: {
      name: "Atelier Rousseau",
      email: "facturation@atelier.test",
      phone: "+15145550147",
      addressLine1: "1250 rue Sainte-Catherine Ouest",
      city: "Montréal",
      province: "QC",
      postalCode: "H3G 1P1",
      country: "CA",
      timezone: TZ,
      billingType: type,
      billingDescription: "Social media management",
      billingAmount: amount,
      billingDate: dateToColumn(date),
      billingTermsDays: 15,
    },
  });
}

const invoicesOf = (clientId: number) =>
  prisma.invoice.findMany({ where: { clientId }, orderBy: { id: "asc" }, include: { lineItems: true, agentTasks: true } });

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("billing plan form values", () => {
  it("requires one-time or monthly billing with description, amount, date and terms", () => {
    const base = { billingDescription: "", billingAmount: "", billingDate: "", billingTermsDays: "15" };
    expect(billingSchema.safeParse({ ...base, billingType: "NONE" }).success).toBe(false);
    const bad = billingSchema.safeParse({ ...base, billingType: "MONTHLY", billingAmount: "0" });
    expect(bad.success).toBe(false);
    const good = billingSchema.safeParse({
      billingType: "MONTHLY",
      billingDescription: "Hosting",
      billingAmount: "49.5",
      billingDate: "2026-11-05",
      billingTermsDays: "30",
    });
    expect(good.success && good.data).toEqual({ type: "MONTHLY", description: "Hosting", amount: "49.50", date: "2026-11-05", termsDays: 30 });
  });

  it("issues a today-dated plan now and a later date at 09:00 in the client's timezone", () => {
    const now = new Date();
    expect(issueAtFor(todayIn(TZ, now), TZ, now)).toBe(now);
    const later = issueAtFor(dateIn(5), TZ, now);
    const wall = wallTimeIn(later, TZ);
    expect([wall.hour, wall.minute]).toEqual([9, 0]);
    expect(todayIn(TZ, later)).toBe(dateIn(5));
  });
});

describe("startClientPlan", () => {
  it("one-time, today: creates the invoice now and queues the agent's email", async () => {
    const client = await clientWithPlan("ONE_TIME", dateIn(0), "900.00");
    const r = await startClientPlan(client.id, "test");
    expect(r.processedNow).toBe(true);

    const [inv] = await invoicesOf(client.id);
    expect(inv).toMatchObject({ status: "CREATED", type: "ONE_TIME", fromClientPlan: true, paymentTerms: "Net 15" });
    expect(inv.total.toString()).toBe("1034.78"); // 900 + GST 5% + QST 9.975%
    expect(inv.lineItems[0].description).toBe("Social media management");
    expect(inv.agentTasks.map((t) => t.type)).toEqual(["INVOICE_EMAIL"]);
  });

  it("one-time, later date: waits as PENDING until that day", async () => {
    const client = await clientWithPlan("ONE_TIME", dateIn(10));
    const r = await startClientPlan(client.id, "test");
    expect(r.processedNow).toBe(false);
    const [inv] = await invoicesOf(client.id);
    expect(inv.status).toBe("PENDING");
    expect(todayIn(TZ, inv.issueAt)).toBe(dateIn(10));
    expect(inv.agentTasks).toHaveLength(0);
  });

  it("monthly: bills today, then schedules next month on the same day", async () => {
    const client = await clientWithPlan("MONTHLY", dateIn(0));
    await startClientPlan(client.id, "test");

    const [first, next] = await invoicesOf(client.id);
    expect(first).toMatchObject({ status: "CREATED", type: "RECURRING", fromClientPlan: true });
    expect(next).toMatchObject({ status: "PENDING", type: "RECURRING", fromClientPlan: true, parentInvoiceId: first.id });
    const a = wallTimeIn(first.issueAt, TZ);
    const b = wallTimeIn(next.issueAt, TZ);
    expect((b.year * 12 + b.month) - (a.year * 12 + a.month)).toBe(1);
    const rule = await prisma.recurringRule.findUniqueOrThrow({ where: { id: first.recurringRuleId! } });
    expect(rule).toMatchObject({ frequency: "MONTHLY", occurrenceCount: null, fromClientPlan: true, stoppedAt: null });
  });
});

describe("stopClientPlan (plan changed)", () => {
  it("cancels the plan's scheduled invoices and stops further months, leaving issued ones alone", async () => {
    const client = await clientWithPlan("MONTHLY", dateIn(0));
    await startClientPlan(client.id, "test");
    const [first, next] = await invoicesOf(client.id);

    expect(await stopClientPlan(client.id, "test")).toEqual({ cancelled: 1 });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: next.id } })).status).toBe("CANCELLED");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("CREATED");

    // A stopped plan never generates another month, even if an occurrence is processed.
    await prisma.invoice.update({ where: { id: next.id }, data: { status: "PENDING" } });
    await processInvoice(next.id, "test");
    expect(await prisma.invoice.count({ where: { clientId: client.id } })).toBe(2);
  });

  it("a new plan after the change bills the new amount", async () => {
    const client = await clientWithPlan("MONTHLY", dateIn(3), "650.00");
    await startClientPlan(client.id, "test");
    await stopClientPlan(client.id, "test");
    await prisma.client.update({ where: { id: client.id }, data: { billingAmount: "800.00", billingDate: dateToColumn(dateIn(4)) } });
    await startClientPlan(client.id, "test");

    const invoices = await invoicesOf(client.id);
    expect(invoices.map((i) => `${i.status}:${i.subtotal.toString()}`)).toEqual(["CANCELLED:650", "PENDING:800"]);
  });
});
