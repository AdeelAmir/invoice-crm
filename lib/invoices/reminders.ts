import { prisma } from "@/lib/db";
import { invoiceConfig } from "@/lib/config";
import { logStep } from "@/lib/invoices/audit";
import type { Prisma } from "@/lib/generated/prisma/client";

// Overdue reminders. The CRM decides which invoices need one; the agent
// sends the email. To send, the agent first claims the reminder: the claim
// is a guarded update, so two runs at once cannot both send the same one.

const DAY = 24 * 60 * 60 * 1000;

// A SENT invoice past its due date, under the reminder limit, whose last
// reminder (if any) is at least the interval old.
function reminderDueWhere(now: Date): Prisma.InvoiceWhereInput {
  const { reminderIntervalDays, reminderMax } = invoiceConfig();
  return {
    status: "SENT",
    dueAt: { lte: now },
    reminderCount: { lt: reminderMax },
    client: { isActive: true },
    OR: [{ lastReminderAt: null }, { lastReminderAt: { lte: new Date(now.getTime() - reminderIntervalDays * DAY) } }],
  };
}

export function remindersDue(now = new Date()) {
  return prisma.invoice.findMany({
    where: reminderDueWhere(now),
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    include: { client: true, lineItems: true, taxes: true },
  });
}

export type ReminderClaim =
  | { found: false }
  | { found: true; claimed: false; reason: string }
  | { found: true; claimed: true; reminderNumber: number };

export async function claimReminder(invoiceId: number, actor: string, now = new Date()): Promise<ReminderClaim> {
  const before = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } });
  if (!before) return { found: false };

  const { count } = await prisma.invoice.updateMany({
    where: { id: invoiceId, ...reminderDueWhere(now) },
    data: { reminderCount: { increment: 1 }, lastReminderAt: now },
  });
  if (count !== 1) {
    const reason =
      before.status === "SENT"
        ? "No reminder due (not overdue yet, sent recently, or the limit is reached)"
        : `Reminders are only sent for SENT invoices (status is ${before.status})`;
    return { found: true, claimed: false, reason };
  }

  const { reminderCount } = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { reminderCount: true },
  });
  await logStep({
    invoiceId,
    step: "REMINDER",
    result: "SUCCESS",
    message: `Overdue reminder ${reminderCount} of ${invoiceConfig().reminderMax} claimed for sending`,
    actor,
  });
  return { found: true, claimed: true, reminderNumber: reminderCount };
}
