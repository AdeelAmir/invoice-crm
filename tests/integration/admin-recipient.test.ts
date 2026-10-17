import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "@/lib/db";
import { createInvoice } from "@/lib/invoices/create";
import { adminAlertEmail } from "@/lib/agent/recipients";
import { escalateToAdmin } from "@/lib/agent/emails";

// Admin emails go to the notification email saved on the Settings page,
// else ADMIN_ALERT_EMAIL (admin-alerts@test.local in tests), else the login email.

async function wipe() {
  await prisma.auditLog.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.client.deleteMany();
  await prisma.admin.deleteMany();
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("admin alert recipient", () => {
  it("uses the Settings email first, then ADMIN_ALERT_EMAIL", async () => {
    expect(await adminAlertEmail()).toBe("admin-alerts@test.local");

    const admin = await prisma.admin.create({
      data: { name: "Owner", email: "owner@company.test", passwordHash: "x", notificationEmail: "alerts@company.test" },
    });
    expect(await adminAlertEmail()).toBe("alerts@company.test");

    await prisma.admin.update({ where: { id: admin.id }, data: { notificationEmail: null } });
    expect(await adminAlertEmail()).toBe("admin-alerts@test.local");
  });

  it("sends escalations to the updated notification email", async () => {
    await prisma.admin.create({
      data: { name: "Owner", email: "owner@company.test", passwordHash: "x", notificationEmail: "billing-team@company.test" },
    });
    const client = await prisma.client.create({
      data: {
        name: "Client Co", email: "c@client.test", phone: "+15145550100", addressLine1: "1 Test St",
        city: "Montréal", province: "QC", postalCode: "H2X 1Y4", country: "CA", timezone: "America/Toronto",
      },
    });
    const r = await createInvoice(
      { clientId: client.id, lineItems: [{ description: "Work", quantity: 1, unitPrice: 100 }], issueAt: new Date(), termsDays: 30 },
      "test",
    );
    if (!r.ok) throw new Error(r.error);

    expect(await escalateToAdmin(r.invoice.id, { category: "REFUND", summary: "Refund asked" }, "agent")).toMatchObject({ ok: true });
    const email = await prisma.emailMessage.findFirstOrThrow({ where: { invoiceId: r.invoice.id, kind: "ESCALATION" } });
    expect(email.toAddress).toBe("billing-team@company.test");
  });
});
