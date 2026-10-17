"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { adminSetStatus, generateNow, retryInvoice } from "@/lib/invoices/service";
import type { ProcessOutcome } from "@/lib/invoices/processor";
import { STATUS_LABELS } from "@/lib/format";
import { recordClientMessage, resolveEscalation } from "@/lib/agent/emails";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatInZone } from "@/lib/timezone";

export type ActionResult = { ok: boolean; message: string };

const idSchema = z.number().int().positive();
const statusSchema = z.enum(["CANCELLED", "PAID"]);

function refresh(id: number) {
  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${id}`);
  revalidatePath("/dashboard/clients", "layout");
}

function describe(result: ProcessOutcome): ActionResult {
  switch (result.outcome) {
    case "created":
      return {
        ok: true,
        message:
          `Invoice created in the payment gateway (${result.gatewayInvoiceId}).` +
          (result.nextInvoiceId ? " Next recurring occurrence generated." : ""),
      };
    case "failed":
      return {
        ok: false,
        message:
          `Processing failed: ${result.error}.` +
          (result.retryLimitReached ? " Retry limit reached." : ` (${result.errorType.toLowerCase()} error)`),
      };
    case "skipped":
      return { ok: false, message: result.reason };
  }
}

export async function retryInvoiceAction(invoiceId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const id = idSchema.parse(invoiceId);
  const result = await retryInvoice(id, `admin:${admin.id}`);
  refresh(id);
  return describe(result);
}

export async function generateNowAction(invoiceId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const id = idSchema.parse(invoiceId);
  const result = await generateNow(id, `admin:${admin.id}`);
  refresh(id);
  return describe(result);
}

export async function setStatusAction(invoiceId: number, status: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const id = idSchema.parse(invoiceId);
  const parsed = statusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, message: "That status cannot be set by hand" };
  const result = await adminSetStatus(id, parsed.data, `admin:${admin.id}`);
  refresh(id);
  return result.ok
    ? { ok: true, message: `Status changed: ${STATUS_LABELS[result.from]} → ${STATUS_LABELS[result.to]}` }
    : { ok: false, message: result.error };
}

// Demo stand-in for an inbound email: the admin types what the client
// wrote, and the agent answers it.
const replySchema = z.string().trim().min(2, "Write the client's message").max(5000);

export async function simulateClientReplyAction(invoiceId: number, text: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const id = idSchema.parse(invoiceId);
  const parsed = replySchema.safeParse(text);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const message = await recordClientMessage(id, parsed.data, `admin:${admin.id}`);
  if (!message) return { ok: false, message: "Invoice not found" };
  refresh(id);
  return { ok: true, message: "Client message recorded. The agent will answer it shortly." };
}

export async function resolveEscalationAction(invoiceId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  const id = idSchema.parse(invoiceId);
  const done = await resolveEscalation(id, `admin:${admin.id}`);
  refresh(id);
  return done ? { ok: true, message: "Marked as resolved" } : { ok: false, message: "Nothing to resolve" };
}

// What the invoice "View" modal shows.
export type InvoicePreview = {
  id: number;
  number: string;
  status: string;
  type: "One-time" | "Recurring";
  client: { id: number; name: string; email: string };
  issueDate: string;
  dueDate: string;
  terms: string;
  currency: string;
  lines: { description: string; quantity: string; unitPrice: string; amount: string }[];
  subtotal: string;
  taxes: { label: string; amount: string }[];
  total: string;
  paidOn: string | null;
  emails: number;
  lastEmail: string | null;
  needsAttention: boolean;
  lastError: string | null;
};

export async function getInvoicePreviewAction(invoiceId: number): Promise<InvoicePreview | null> {
  await requireAdmin();
  const id = idSchema.parse(invoiceId);
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, email: true, timezone: true } },
      lineItems: { orderBy: { position: "asc" } },
      taxes: true,
      emails: { where: { direction: "OUTBOUND" }, orderBy: { createdAt: "desc" }, select: { kind: true, createdAt: true } },
    },
  });
  if (!inv) return null;
  const money = (v: { toString(): string }) => formatMoney(v, inv.currency);
  const tz = inv.client.timezone;
  const last = inv.emails[0];
  return {
    id: inv.id,
    number: inv.invoiceNumber,
    status: inv.status,
    type: inv.type === "RECURRING" ? "Recurring" : "One-time",
    client: { id: inv.client.id, name: inv.client.name, email: inv.client.email },
    issueDate: formatInZone(inv.issueAt, tz, false),
    dueDate: formatInZone(inv.dueAt, tz, false),
    terms: inv.paymentTerms,
    currency: inv.currency,
    lines: inv.lineItems.map((l) => ({
      description: l.description,
      quantity: String(Number(l.quantity)),
      unitPrice: money(l.unitPrice),
      amount: money(l.lineTotal),
    })),
    subtotal: money(inv.subtotal),
    taxes: inv.taxes.map((t) => ({ label: `${t.name} (${Number(t.rate)}%)`, amount: money(t.amount) })),
    total: money(inv.total),
    paidOn: inv.paidAt ? formatInZone(inv.paidAt, tz) : null,
    emails: inv.emails.length,
    lastEmail: last ? `${last.kind.toLowerCase()} · ${formatInZone(last.createdAt, tz)}` : null,
    needsAttention: inv.needsAttention,
    lastError: inv.status === "FAILED" ? inv.lastError : null,
  };
}

// Deletes an invoice with its items, taxes, emails, tasks and audit log.
// Deleting the upcoming invoice of a recurring schedule stops that schedule.
export async function deleteInvoiceAction(invoiceId: number): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.parse(invoiceId);
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { invoiceNumber: true, status: true, recurringRuleId: true } });
  if (!inv) return { ok: false, message: "Invoice not found" };
  await prisma.$transaction(async (tx) => {
    if (inv.recurringRuleId && inv.status === "PENDING") {
      await tx.recurringRule.update({ where: { id: inv.recurringRuleId }, data: { stoppedAt: new Date() } });
    }
    await tx.invoice.delete({ where: { id } });
  });
  revalidatePath("/dashboard/invoices", "layout");
  revalidatePath("/dashboard/clients", "layout");
  return { ok: true, message: `${inv.invoiceNumber} deleted` };
}
