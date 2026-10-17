import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "@/lib/db";
import { createInvoice } from "@/lib/invoices/create";
import { processInvoice } from "@/lib/invoices/processor";
import { systemSetStatus } from "@/lib/invoices/service";
import { claimReminder, remindersDue } from "@/lib/invoices/reminders";
import { signPayload } from "@/lib/invoices/webhook";
import { GET as listRoute, POST as createRoute } from "@/app/api/invoices/route";
import { POST as processRoute } from "@/app/api/invoices/[id]/process/route";
import { POST as retryRoute } from "@/app/api/invoices/[id]/retry/route";
import { POST as reminderRoute } from "@/app/api/invoices/[id]/reminder/route";
import { GET as remindersRoute } from "@/app/api/invoices/reminders/route";
import { POST as webhookRoute } from "@/app/api/webhooks/payment/route";
import { GET as clientsRoute } from "@/app/api/clients/route";

// The CRM side of the agent: create invoices, process/retry them, overdue
// reminders and the payment webhook.

const API_KEY = "integration-test-api-key-123456";
const WEBHOOK_SECRET = "integration-test-webhook-secret-123456";
const DAY = 86_400_000;
const url = (path: string) => `http://localhost${path}`;
const auth = { "x-api-key": API_KEY, "content-type": "application/json" };
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function wipe() {
  await prisma.webhookEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.invoiceLineItem.deleteMany();
  await prisma.invoiceTax.deleteMany();
  await prisma.invoice.updateMany({ data: { parentInvoiceId: null } });
  await prisma.invoice.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.client.deleteMany();
  await prisma.mockGatewayInvoice.deleteMany();
}

async function makeClient(overrides: Partial<{ name: string; isActive: boolean }> = {}) {
  return prisma.client.create({
    data: {
      name: overrides.name ?? "Test Client",
      email: "billing@test.ca",
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

// A SENT invoice whose due date is `overdueDays` in the past.
async function sentInvoice(clientId: number, overdueDays: number) {
  const r = await createInvoice(
    {
      clientId,
      lineItems: [{ description: "Service", quantity: 1, unitPrice: 100 }],
      issueAt: new Date(Date.now() - (30 + overdueDays) * DAY),
      termsDays: 30,
    },
    "test",
  );
  if (!r.ok) throw new Error(r.error);
  await processInvoice(r.invoice.id, "test");
  await systemSetStatus(r.invoice.id, { status: "SENT" }, "test");
  return r.invoice;
}

const reload = (id: number) => prisma.invoice.findUniqueOrThrow({ where: { id } });
const post = (path: string, body?: unknown) =>
  new Request(url(path), { method: "POST", headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });

function webhook(body: object, secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify(body);
  return webhookRoute(
    new Request(url("/api/webhooks/payment"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-signature": signPayload(raw, secret) },
      body: raw,
    }),
  );
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("POST /api/invoices", () => {
  it("adds a PENDING one-time invoice with tax from the client's province", async () => {
    const client = await makeClient();
    const res = await createRoute(
      post("/api/invoices", {
        clientId: client.id,
        lineItems: [{ description: "Consulting (hours)", quantity: 2, unitPrice: 50 }],
      }),
    );
    expect(res.status).toBe(201);
    const { invoice } = await res.json();
    expect(invoice).toMatchObject({
      status: "PENDING",
      type: "ONE_TIME",
      subtotal: "100.00",
      taxTotal: "14.98",
      total: "114.98",
      paymentTerms: "Net 30",
      invoiceNumber: `INV-${String(invoice.id).padStart(5, "0")}`,
    });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(log.step).toBe("INVOICE_CREATE");
  });

  it("adds a recurring invoice whose processing generates the next occurrence", async () => {
    const client = await makeClient();
    const res = await createRoute(
      post("/api/invoices", {
        clientId: client.id,
        lineItems: [{ description: "Hosting", quantity: 1, unitPrice: 30 }],
        recurring: { frequency: "MONTHLY", occurrenceCount: 12 },
      }),
    );
    const { invoice } = await res.json();
    expect(invoice.type).toBe("RECURRING");

    const processed = await processRoute(post(`/api/invoices/${invoice.id}/process`), params(invoice.id));
    expect(processed.status).toBe(200);
    const body = await processed.json();
    expect(body.outcome).toBe("created");
    expect(body.invoice.status).toBe("CREATED");
    expect(body.nextInvoiceId).toBeTruthy();

    const again = await processRoute(post(`/api/invoices/${invoice.id}/process`), params(invoice.id));
    expect(again.status).toBe(409);
  });

  it("rejects bad input, unknown and deactivated clients, and missing keys", async () => {
    const inactive = await makeClient({ isActive: false });
    const bad = await createRoute(post("/api/invoices", { clientId: inactive.id, lineItems: [] }));
    expect(bad.status).toBe(400);

    const deactivated = await createRoute(
      post("/api/invoices", { clientId: inactive.id, lineItems: [{ description: "x", quantity: 1, unitPrice: 1 }] }),
    );
    expect(deactivated.status).toBe(409);

    const unknown = await createRoute(
      post("/api/invoices", { clientId: 999999, lineItems: [{ description: "x", quantity: 1, unitPrice: 1 }] }),
    );
    expect(unknown.status).toBe(404);

    const noKey = await createRoute(new Request(url("/api/invoices"), { method: "POST", body: "{}" }));
    expect(noKey.status).toBe(401);
  });
});

describe("listing and retry", () => {
  it("lists invoices by status and finds clients by name", async () => {
    const client = await makeClient({ name: "Northwind Trading" });
    await sentInvoice(client.id, 1);

    const list = await listRoute(new Request(url("/api/invoices?status=SENT"), { headers: auth }));
    const body = await list.json();
    expect(body.count).toBe(1);
    expect(body.invoices[0].sentAt).not.toBeNull();

    const clients = await clientsRoute(new Request(url("/api/clients?search=northwind"), { headers: auth }));
    expect((await clients.json()).clients.map((c: { id: number }) => c.id)).toEqual([client.id]);
  });

  it("retries a failed invoice through the API", async () => {
    const client = await makeClient();
    const r = await createInvoice(
      {
        clientId: client.id,
        lineItems: [{ description: "Service", quantity: 1, unitPrice: 100 }],
        issueAt: new Date(),
        termsDays: 30,
        simulateFailure: "TIMEOUT",
      },
      "test",
    );
    if (!r.ok) throw new Error(r.error);
    const first = await processRoute(post(`/api/invoices/${r.invoice.id}/process`), params(r.invoice.id));
    expect((await first.json()).outcome).toBe("failed");

    const retried = await retryRoute(post(`/api/invoices/${r.invoice.id}/retry`), params(r.invoice.id));
    expect(retried.status).toBe(200);
    expect((await retried.json()).invoice.status).toBe("CREATED");
  });
});

describe("overdue reminders", () => {
  it("lists only overdue SENT invoices and claims each reminder once per interval", async () => {
    const client = await makeClient();
    const overdue = await sentInvoice(client.id, 2);
    await sentInvoice(client.id, -5); // due in 5 days

    const list = await remindersRoute(new Request(url("/api/invoices/reminders"), { headers: auth }));
    const body = await list.json();
    expect(body.invoices.map((i: { id: number }) => i.id)).toEqual([overdue.id]);

    const first = await reminderRoute(post(`/api/invoices/${overdue.id}/reminder`), params(overdue.id));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ claimed: true, reminderNumber: 1 });

    const tooSoon = await reminderRoute(post(`/api/invoices/${overdue.id}/reminder`), params(overdue.id));
    expect(tooSoon.status).toBe(409);
    expect(await remindersDue()).toHaveLength(0);

    // Three days later the next one is due.
    const later = new Date(Date.now() + 3 * DAY + 1000);
    expect((await remindersDue(later)).map((i) => i.id)).toEqual([overdue.id]);
  });

  it("stops at the limit and lets only one of several concurrent runs claim", async () => {
    const client = await makeClient();
    const inv = await sentInvoice(client.id, 30);

    const claims = await Promise.all(Array.from({ length: 5 }, () => claimReminder(inv.id, "test")));
    expect(claims.filter((c) => c.found && c.claimed)).toHaveLength(1);

    let now = Date.now();
    for (let i = 0; i < 2; i++) {
      now += 3 * DAY + 1000;
      expect(await claimReminder(inv.id, "test", new Date(now))).toMatchObject({ claimed: true });
    }
    now += 3 * DAY + 1000;
    expect(await claimReminder(inv.id, "test", new Date(now))).toMatchObject({ claimed: false });
    expect((await reload(inv.id)).reminderCount).toBe(3);
  });
});

describe("POST /api/webhooks/payment", () => {
  it("marks the invoice PAID once, even when the event is delivered again", async () => {
    const client = await makeClient();
    const inv = await sentInvoice(client.id, 2);
    const event = { id: `evt_${randomUUID()}`, type: "invoice.paid", data: { invoiceId: inv.id } };

    const res = await webhook(event);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ changed: true, duplicate: false, status: "PAID" });
    const after = await reload(inv.id);
    expect(after.status).toBe("PAID");
    expect(after.paidAt).not.toBeNull();
    expect(await remindersDue()).toHaveLength(0);

    const repeat = await webhook(event);
    expect(await repeat.json()).toMatchObject({ duplicate: true, changed: false });
    expect(await prisma.webhookEvent.count()).toBe(1);
  });

  it("finds the invoice by gateway id and logs failed payments without a status change", async () => {
    const client = await makeClient();
    const inv = await sentInvoice(client.id, 2);
    const { gatewayInvoiceId } = await reload(inv.id);

    const res = await webhook({
      id: `evt_${randomUUID()}`,
      type: "invoice.payment_failed",
      data: { gatewayInvoiceId, reason: "Card declined" },
    });
    expect(res.status).toBe(200);
    expect((await reload(inv.id)).status).toBe("SENT");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { invoiceId: inv.id, step: "PAYMENT_WEBHOOK" } });
    expect(log.result).toBe("FAILURE");
  });

  it("rejects a bad signature and unknown invoices", async () => {
    const event = { id: "evt_x", type: "invoice.paid", data: { invoiceId: 999999 } };
    expect((await webhook(event, "wrong-secret-wrong-secret")).status).toBe(401);
    expect((await webhook(event)).status).toBe(404);
  });
});
