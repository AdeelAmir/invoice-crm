import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "@/lib/db";
import { claimInvoice, invoiceNumberFor, processInvoice } from "@/lib/invoices/processor";
import {
  adminSetStatus,
  dueInvoices,
  generateNow,
  retryInvoice,
  systemSetStatus,
} from "@/lib/invoices/service";
import { createGatewayInvoice } from "@/lib/gateway/mock";
import { GET as dueRoute } from "@/app/api/invoices/due/route";
import { POST as claimRoute } from "@/app/api/invoices/[id]/claim/route";
import type { RecurrenceFrequency, SimulatedFailure } from "@/lib/generated/prisma/enums";

const API_KEY = "integration-test-api-key-123456";

async function wipe() {
  await prisma.auditLog.deleteMany();
  await prisma.invoiceLineItem.deleteMany();
  await prisma.invoiceTax.deleteMany();
  await prisma.invoice.updateMany({ data: { parentInvoiceId: null } });
  await prisma.invoice.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.client.deleteMany();
  await prisma.mockGatewayInvoice.deleteMany();
}

async function makeClient(overrides: Partial<{ email: string; isActive: boolean }> = {}) {
  return prisma.client.create({
    data: {
      name: "Test Client",
      email: overrides.email ?? "billing@test.ca",
      phone: "+15145550100",
      addressLine1: "1 Test Street",
      city: "Montréal",
      province: "QC",
      postalCode: "H2X 1Y4",
      country: "CA",
      timezone: "America/Toronto",
      isActive: overrides.isActive ?? true,
    },
  });
}

async function makeInvoice(
  clientId: number,
  opts: {
    issueAt?: Date;
    simulateFailure?: SimulatedFailure;
    recurring?: { frequency: RecurrenceFrequency; occurrenceCount: number };
  } = {},
) {
  const issueAt = opts.issueAt ?? new Date(Date.now() - 60_000);
  const rule = opts.recurring
    ? await prisma.recurringRule.create({
        data: { clientId, ...opts.recurring, startDate: issueAt, generatedCount: 1 },
      })
    : null;
  const inv = await prisma.invoice.create({
    data: {
      invoiceNumber: `TMP-${randomUUID()}`,
      clientId,
      subtotal: "100.00",
      taxTotal: "14.98",
      total: "114.98",
      issueAt,
      dueAt: new Date(issueAt.getTime() + 30 * 86_400_000),
      paymentTerms: "Net 30",
      type: rule ? "RECURRING" : "ONE_TIME",
      simulateFailure: opts.simulateFailure ?? "NONE",
      recurringRuleId: rule?.id ?? null,
      lineItems: { create: [{ description: "Service", quantity: "1", unitPrice: "100.00", lineTotal: "100.00" }] },
      taxes: {
        create: [
          { name: "GST", rate: "5", amount: "5.00" },
          { name: "QST", rate: "9.975", amount: "9.98" },
        ],
      },
    },
  });
  return prisma.invoice.update({ where: { id: inv.id }, data: { invoiceNumber: invoiceNumberFor(inv.id) } });
}

const reload = (id: number) => prisma.invoice.findUniqueOrThrow({ where: { id } });
const steps = async (id: number) =>
  (await prisma.auditLog.findMany({ where: { invoiceId: id }, orderBy: { id: "asc" } })).map(
    (l) => `${l.step}:${l.result}`,
  );

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("processInvoice", () => {
  it("claims, creates in the gateway, marks CREATED and logs each step", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);

    const r = await processInvoice(inv.id, "test");

    expect(r.outcome).toBe("created");
    const after = await reload(inv.id);
    expect(after.status).toBe("CREATED");
    expect(after.gatewayInvoiceId).toMatch(/^gw_in_/);
    expect(after.processingStartedAt).toBeNull();
    expect(await steps(inv.id)).toEqual(["CLAIM:SUCCESS", "GATEWAY_CREATE:SUCCESS", "STATUS_UPDATE:SUCCESS"]);
  });

  it("duplicate runs: five at once create exactly one gateway invoice", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);

    const results = await Promise.all(Array.from({ length: 5 }, () => processInvoice(inv.id, "test")));

    expect(results.filter((r) => r.outcome === "created")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "skipped")).toHaveLength(4);
    expect(await prisma.mockGatewayInvoice.count()).toBe(1);
    expect((await reload(inv.id)).status).toBe("CREATED");
  });

  it("gateway timeout: FAILED as retryable with a backoff, then Retry succeeds", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id, { simulateFailure: "TIMEOUT" });

    const first = await processInvoice(inv.id, "test");
    expect(first).toMatchObject({ outcome: "failed", errorType: "RETRYABLE", retryCount: 1 });
    const failed = await reload(inv.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());

    const second = await retryInvoice(inv.id, "test");
    expect(second.outcome).toBe("created");
    const done = await reload(inv.id);
    expect(done).toMatchObject({ status: "CREATED", lastError: null, errorType: null, retryCount: 1 });
  });

  it("permanent error (invalid email) goes straight to FAILED; fixing the data lets Retry succeed", async () => {
    const client = await makeClient({ email: "factures@cafe" });
    const inv = await makeInvoice(client.id);

    const r = await processInvoice(inv.id, "test");
    expect(r).toMatchObject({ outcome: "failed", errorType: "PERMANENT" });
    expect((await reload(inv.id)).nextRetryAt).toBeNull();
    expect(await prisma.mockGatewayInvoice.count()).toBe(0);

    await prisma.client.update({ where: { id: client.id }, data: { email: "factures@cafe.ca" } });
    expect((await retryInvoice(inv.id, "test")).outcome).toBe("created");
  });

  it("stops retrying at the limit", async () => {
    const client = await makeClient({ email: "broken" });
    const inv = await makeInvoice(client.id);
    await processInvoice(inv.id, "test");
    await retryInvoice(inv.id, "test");
    const third = await retryInvoice(inv.id, "test");
    expect(third).toMatchObject({ outcome: "failed", retryCount: 3, retryLimitReached: true });

    const fourth = await retryInvoice(inv.id, "test");
    expect(fourth).toEqual({ outcome: "skipped", reason: "Retry limit reached (3 of 3)" });
    expect((await reload(inv.id)).status).toBe("FAILED");
  });

  it("concurrent Retry clicks process the invoice once", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id, { simulateFailure: "TIMEOUT" });
    await processInvoice(inv.id, "test");

    const results = await Promise.all([1, 2, 3].map(() => retryInvoice(inv.id, "test")));
    expect(results.filter((r) => r.outcome === "created")).toHaveLength(1);
    expect(await prisma.mockGatewayInvoice.count()).toBe(1);
  });

  it("crash mid-flow: a stuck invoice is recovered without a second gateway invoice", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);
    // The crashed run had claimed the invoice and created it in the gateway.
    const claimedAt = await claimInvoice(inv.id, "crashed-run");
    const gw = await createGatewayInvoice({ idempotencyKey: `crm-invoice-${inv.id}`, amountCents: 11498, currency: "CAD" });
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { processingStartedAt: new Date(Date.now() - 60 * 60_000) },
    });

    const r = await retryInvoice(inv.id, "test");
    expect(r).toMatchObject({ outcome: "created", gatewayInvoiceId: gw.gatewayId, replayed: true });
    expect(await prisma.mockGatewayInvoice.count()).toBe(1);

    // The crashed run, if it ever wakes up, no longer owns the invoice.
    const stale = await prisma.invoice.updateMany({
      where: { id: inv.id, status: "PROCESSING", processingStartedAt: claimedAt! },
      data: { status: "FAILED" },
    });
    expect(stale.count).toBe(0);
  });

  it("a recent PROCESSING invoice cannot be retried", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);
    await claimInvoice(inv.id, "other-run");
    expect((await retryInvoice(inv.id, "test")).outcome).toBe("skipped");
  });

  it("a cancelled invoice is never processed", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);
    expect((await adminSetStatus(inv.id, "CANCELLED", "test")).ok).toBe(true);

    expect((await generateNow(inv.id, "test")).outcome).toBe("skipped");
    expect((await retryInvoice(inv.id, "test")).outcome).toBe("skipped");
    expect(await claimInvoice(inv.id, "test")).toBeNull();
    expect(await prisma.mockGatewayInvoice.count()).toBe(0);
  });

  it("a deactivated client's invoice fails permanently", async () => {
    const client = await makeClient({ isActive: false });
    const inv = await makeInvoice(client.id);
    expect(await processInvoice(inv.id, "test")).toMatchObject({
      outcome: "failed",
      errorType: "PERMANENT",
      error: "Client is deactivated",
    });
  });
});

describe("recurring rollover", () => {
  it("generates the next occurrence once, and stops at the occurrence count", async () => {
    const client = await makeClient();
    const first = await makeInvoice(client.id, { recurring: { frequency: "MONTHLY", occurrenceCount: 2 } });

    const r1 = await processInvoice(first.id, "test");
    expect(r1.outcome).toBe("created");
    const nextId = r1.outcome === "created" ? r1.nextInvoiceId : null;
    expect(nextId).not.toBeNull();
    const second = await reload(nextId!);
    expect(second).toMatchObject({ status: "PENDING", parentInvoiceId: first.id, type: "RECURRING" });
    expect(second.issueAt.getTime()).toBeGreaterThan(first.issueAt.getTime());

    const r2 = await processInvoice(second.id, "test");
    expect(r2).toMatchObject({ outcome: "created", nextInvoiceId: null });
    expect(await prisma.invoice.count()).toBe(2);
    expect((await prisma.recurringRule.findFirstOrThrow()).generatedCount).toBe(2);
  });
});

describe("status updates", () => {
  it("admins cannot jump FAILED to PAID; CREATED to PAID is allowed and logged", async () => {
    const client = await makeClient({ email: "bad" });
    const failed = await makeInvoice(client.id);
    await processInvoice(failed.id, "test");
    expect(await adminSetStatus(failed.id, "PAID", "admin:1")).toMatchObject({ ok: false });

    const good = await makeClient();
    const inv = await makeInvoice(good.id);
    await processInvoice(inv.id, "test");
    expect(await adminSetStatus(inv.id, "PAID", "admin:1")).toMatchObject({ ok: true, from: "CREATED", to: "PAID" });
    expect((await steps(inv.id)).at(-1)).toBe("MANUAL_STATUS:SUCCESS");
  });

  it("the API needs a gateway id to mark CREATED and an error to mark FAILED", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);
    await claimInvoice(inv.id, "api");
    expect(await systemSetStatus(inv.id, { status: "CREATED" }, "api")).toMatchObject({ ok: false });
    expect(await systemSetStatus(inv.id, { status: "FAILED" }, "api")).toMatchObject({ ok: false });
    expect(await systemSetStatus(inv.id, { status: "CREATED", gatewayInvoiceId: "gw_x" }, "api")).toMatchObject({
      ok: true,
    });
  });
});

describe("dueInvoices", () => {
  it("returns pending in the window, retryable failures that are due, and stuck invoices", async () => {
    const client = await makeClient();
    const now = Date.now();
    const pending = await makeInvoice(client.id, { issueAt: new Date(now - 3_600_000) });
    const future = await makeInvoice(client.id, { issueAt: new Date(now + 5 * 86_400_000) });
    const backingOff = await makeInvoice(client.id, { simulateFailure: "TIMEOUT" });
    await processInvoice(backingOff.id, "test"); // nextRetryAt is in the future
    const stuck = await makeInvoice(client.id);
    await claimInvoice(stuck.id, "test");
    await prisma.invoice.update({ where: { id: stuck.id }, data: { processingStartedAt: new Date(now - 3_600_000) } });

    const due = await dueInvoices({
      from: new Date(now - 86_400_000),
      to: new Date(now),
      statuses: ["PENDING", "FAILED", "PROCESSING"],
    });
    const ids = due.map((d) => d.id).sort();
    expect(ids).toEqual([pending.id, stuck.id].sort());
    expect(ids).not.toContain(future.id);
    expect(ids).not.toContain(backingOff.id);
  });
});

describe("API routes", () => {
  const url = (path: string) => `http://localhost:3010${path}`;

  it("rejects requests without the API key", async () => {
    const res = await dueRoute(new Request(url("/api/invoices/due?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z")));
    expect(res.status).toBe(401);
  });

  it("lists due invoices and validates the window", async () => {
    const client = await makeClient();
    await makeInvoice(client.id);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date().toISOString();
    const ok = await dueRoute(
      new Request(url(`/api/invoices/due?from=${from}&to=${to}`), { headers: { "x-api-key": API_KEY } }),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.count).toBe(1);
    expect(body.invoices[0]).toMatchObject({ total: "114.98", status: "PENDING" });

    const bad = await dueRoute(new Request(url("/api/invoices/due?from=yesterday"), { headers: { "x-api-key": API_KEY } }));
    expect(bad.status).toBe(400);
  });

  it("claims once (200) and refuses the second claim (409)", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);
    const call = () =>
      claimRoute(new Request(url(`/api/invoices/${inv.id}/claim`), { method: "POST", headers: { "x-api-key": API_KEY } }), {
        params: Promise.resolve({ id: String(inv.id) }),
      });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(409);
  });
});
