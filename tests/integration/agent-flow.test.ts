import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "@/lib/db";
import { createInvoice } from "@/lib/invoices/create";
import { processInvoice } from "@/lib/invoices/processor";
import { adminSetStatus, systemSetStatus } from "@/lib/invoices/service";
import { claimNextTask, completeTask, failTask } from "@/lib/agent/tasks";
import {
  enqueueDueReminders,
  escalateToAdmin,
  invoiceContext,
  recordClientMessage,
  runCodeTask,
  sendAgentEmail,
} from "@/lib/agent/emails";
import { payInvoiceAction } from "@/app/pay/[id]/actions";
import { POST as emailsRoute } from "@/app/api/agent/invoices/[id]/emails/route";
import { POST as claimRoute } from "@/app/api/agent/tasks/claim/route";

// The CRM side of the Managed Agent: the task queue it pulls from and the
// rules every email it sends goes through.

const API_KEY = "integration-test-api-key-123456";
const DAY = 86_400_000;
const url = (path: string) => `http://localhost${path}`;

async function wipe() {
  await prisma.webhookEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.invoice.updateMany({ data: { parentInvoiceId: null } });
  await prisma.invoice.deleteMany(); // cascades line items, taxes, emails, tasks
  await prisma.recurringRule.deleteMany();
  await prisma.client.deleteMany();
  await prisma.mockGatewayInvoice.deleteMany();
}

async function makeClient(email = "billing@client.test") {
  return prisma.client.create({
    data: {
      name: "Client Co",
      email,
      phone: "+15145550100",
      addressLine1: "1 Test Street",
      city: "Montréal",
      province: "QC",
      postalCode: "H2X 1Y4",
      country: "CA",
      timezone: "America/Toronto",
    },
  });
}

async function makeInvoice(clientId: number, overdueDays?: number) {
  const issueAt = overdueDays === undefined ? new Date(Date.now() - 60_000) : new Date(Date.now() - (30 + overdueDays) * DAY);
  const r = await createInvoice(
    { clientId, lineItems: [{ description: "Website work", quantity: 2, unitPrice: 50 }], issueAt, termsDays: 30 },
    "test",
  );
  if (!r.ok) throw new Error(r.error);
  return r.invoice;
}

const tasksFor = (invoiceId: number) => prisma.agentTask.findMany({ where: { invoiceId }, orderBy: { id: "asc" } });
const emailsFor = (invoiceId: number) => prisma.emailMessage.findMany({ where: { invoiceId }, orderBy: { id: "asc" } });
const reload = (id: number) => prisma.invoice.findUniqueOrThrow({ where: { id } });

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("task queue", () => {
  it("queues one invoice-email task when an invoice is created, even if processing repeats", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);
    await processInvoice(inv.id, "test");
    await processInvoice(inv.id, "test");
    await systemSetStatus(inv.id, { status: "CREATED" }, "test"); // refused: already CREATED

    const tasks = await tasksFor(inv.id);
    expect(tasks.map((t) => `${t.type}:${t.status}`)).toEqual(["INVOICE_EMAIL:PENDING"]);
  });

  it("lets only one of several concurrent runners claim a task", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);
    await processInvoice(inv.id, "test");

    const claims = await Promise.all(Array.from({ length: 5 }, () => claimNextTask()));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const [task] = await tasksFor(inv.id);
    expect(task.status).toBe("RUNNING");
    expect(task.attempts).toBe(1);
  });

  it("skips a task whose invoice moved on, and retries failures up to the limit", async () => {
    const client = await makeClient();
    const cancelled = await makeInvoice(client.id);
    await processInvoice(cancelled.id, "test");
    await adminSetStatus(cancelled.id, "CANCELLED", "test");
    expect(await claimNextTask()).toBeNull();
    expect((await tasksFor(cancelled.id))[0]).toMatchObject({ status: "DONE", result: expect.stringContaining("Skipped") });

    const inv = await makeInvoice(client.id);
    await processInvoice(inv.id, "test");
    for (let attempt = 1; attempt <= 3; attempt++) {
      const task = await claimNextTask();
      expect(task?.attempts).toBe(attempt);
      const r = await failTask(task!.id, "agent error", "test");
      expect(r).toEqual({ ok: true, status: attempt < 3 ? "PENDING" : "FAILED" });
    }
    expect(await claimNextTask()).toBeNull();
  });
});

describe("invoice email", () => {
  it("goes to the client's address with the CRM's totals and payment link, then marks the invoice SENT, once", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);
    await processInvoice(inv.id, "test");

    const r = await sendAgentEmail(inv.id, "INVOICE", { subject: "Your invoice", body: "Hello, here is your invoice." }, "agent");
    expect(r.ok).toBe(true);
    const [email] = await emailsFor(inv.id);
    expect(email).toMatchObject({ kind: "INVOICE", toAddress: "billing@client.test", delivery: "OUTBOX" });
    expect(email.body).toContain("Hello, here is your invoice.");
    expect(email.body).toContain("Amount due: $114.98 CAD");
    expect(email.body).toContain("Total: $114.98 CAD");
    expect(email.body).toContain(`Pay $114.98 now: http://localhost:3010/pay/${inv.id}`);
    // The designed version carries the same figures and the pay button.
    expect(email.html).toContain(`href="http://localhost:3010/pay/${inv.id}"`);
    expect(email.html).toContain("Pay $114.98 now");
    expect(email.html).toContain("Hello, here is your invoice.");
    const after = await reload(inv.id);
    expect(after.status).toBe("SENT");
    expect(after.sentAt).not.toBeNull();

    const again = await sendAgentEmail(inv.id, "INVOICE", { subject: "Again", body: "Again" }, "agent");
    expect(again).toMatchObject({ ok: true, alreadySent: true });
    expect(await emailsFor(inv.id)).toHaveLength(1);
  });

  it("is refused before the invoice is created, and through the API (409, 401)", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id); // PENDING
    expect(await sendAgentEmail(inv.id, "INVOICE", { subject: "x", body: "x" }, "agent")).toMatchObject({ ok: false });

    const call = (key?: string) =>
      emailsRoute(
        new Request(url(`/api/agent/invoices/${inv.id}/emails`), {
          method: "POST",
          headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
          body: JSON.stringify({ kind: "INVOICE", subject: "x", body: "x" }),
        }),
        { params: Promise.resolve({ id: String(inv.id) }) },
      );
    expect((await call()).status).toBe(401);
    expect((await call(API_KEY)).status).toBe(409);
    expect(await emailsFor(inv.id)).toHaveLength(0);
  });
});

describe("mock payment and receipt", () => {
  it("pays through the webhook code, queues the receipt, and allows one receipt only after payment", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);
    await processInvoice(inv.id, "test");
    await sendAgentEmail(inv.id, "INVOICE", { subject: "Invoice", body: "Hi" }, "agent");

    expect(await sendAgentEmail(inv.id, "RECEIPT", { subject: "Thanks", body: "Thanks" }, "agent")).toMatchObject({ ok: false });

    expect(await payInvoiceAction(inv.id)).toMatchObject({ ok: true });
    expect(await payInvoiceAction(inv.id)).toMatchObject({ ok: true, message: "This invoice is already paid." });
    const paid = await reload(inv.id);
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).not.toBeNull();
    expect((await tasksFor(inv.id)).map((t) => t.type)).toEqual(["INVOICE_EMAIL", "RECEIPT_EMAIL"]);

    expect(await sendAgentEmail(inv.id, "RECEIPT", { subject: "Thanks", body: "Thank you!" }, "agent")).toMatchObject({ ok: true });
    expect(await sendAgentEmail(inv.id, "RECEIPT", { subject: "Thanks", body: "Again" }, "agent")).toMatchObject({ alreadySent: true });
    const receipts = (await emailsFor(inv.id)).filter((e) => e.kind === "RECEIPT");
    expect(receipts).toHaveLength(1);
    expect(receipts[0].body).toContain("Amount paid: $114.98 CAD");
  });

  it("refuses to pay an invoice that is not payable", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id); // PENDING
    expect(await payInvoiceAction(inv.id)).toMatchObject({ ok: false });
    expect((await reload(inv.id)).status).toBe("PENDING");
  });
});

describe("reminders, replies and escalation", () => {
  it("queues a reminder for an overdue invoice and allows exactly that reminder", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id, 5);
    await processInvoice(inv.id, "test");
    await sendAgentEmail(inv.id, "INVOICE", { subject: "Invoice", body: "Hi" }, "agent");

    expect(await enqueueDueReminders("test")).toBe(1);
    expect(await enqueueDueReminders("test")).toBe(0);
    const task = (await tasksFor(inv.id)).find((t) => t.type === "REMINDER_EMAIL");
    expect(task?.payload).toEqual({ reminderNumber: 1 });

    expect(await sendAgentEmail(inv.id, "REMINDER", { subject: "Reminder", body: "Please pay" }, "agent")).toMatchObject({ ok: true });
    expect(await sendAgentEmail(inv.id, "REMINDER", { subject: "Reminder", body: "Again" }, "agent")).toMatchObject({ alreadySent: true });
    expect((await invoiceContext(inv.id))?.invoice.remindersSent).toBe(1);
  });

  it("answers each client message once and escalates without touching the invoice", async () => {
    const client = await makeClient();
    const inv = await makeInvoice(client.id);
    await processInvoice(inv.id, "test");
    await sendAgentEmail(inv.id, "INVOICE", { subject: "Invoice", body: "Hi" }, "agent");

    expect(await sendAgentEmail(inv.id, "REPLY", { subject: "Re", body: "x" }, "agent")).toMatchObject({ ok: false });

    const message = await recordClientMessage(inv.id, "I was charged twice, I want a refund", "admin:1");
    const replyTask = (await tasksFor(inv.id)).find((t) => t.type === "CLIENT_REPLY");
    expect(replyTask?.payload).toEqual({ messageId: message!.id });

    const ctx = await invoiceContext(inv.id);
    expect(ctx?.conversation.at(-1)).toMatchObject({ kind: "CLIENT_MESSAGE", from: expect.stringContaining("untrusted") });

    const before = await reload(inv.id);
    const esc = await escalateToAdmin(inv.id, { category: "REFUND", summary: "Client asks for a refund" }, "agent");
    expect(esc.ok).toBe(true);
    const after = await reload(inv.id);
    expect(after.needsAttention).toBe(true);
    expect(after.status).toBe(before.status);
    expect(after.total.toString()).toBe(before.total.toString());
    const escalation = (await emailsFor(inv.id)).find((e) => e.kind === "ESCALATION");
    expect(escalation?.toAddress).toBe("admin-alerts@test.local");

    expect(await sendAgentEmail(inv.id, "REPLY", { subject: "Re", body: "The team will contact you." }, "agent")).toMatchObject({ ok: true });
    expect(await sendAgentEmail(inv.id, "REPLY", { subject: "Re", body: "Again" }, "agent")).toMatchObject({ alreadySent: true });
  });
});

describe("failure alert", () => {
  it("queues an admin alert for a permanent failure and sends it by code through the runner API", async () => {
    const client = await makeClient("broken-email"); // invalid: permanent failure
    const inv = await makeInvoice(client.id);
    const r = await processInvoice(inv.id, "test");
    expect(r).toMatchObject({ outcome: "failed", errorType: "PERMANENT" });

    const res = await claimRoute(new Request(url("/api/agent/tasks/claim"), { method: "POST", headers: { "x-api-key": API_KEY } }));
    const { task } = await res.json();
    expect(task).toMatchObject({ type: "ADMIN_ALERT", invoiceId: inv.id });

    expect(await runCodeTask(task.id, "test")).toMatchObject({ ok: true });
    const alert = (await emailsFor(inv.id)).find((e) => e.kind === "ALERT");
    expect(alert?.toAddress).toBe("admin-alerts@test.local");
    expect(alert?.body).toContain("Invalid client email");
    expect((await tasksFor(inv.id))[0].status).toBe("DONE");
    expect(await completeTask(task.id, "again", "test")).toMatchObject({ ok: false });
  });
});
