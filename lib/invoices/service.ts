import { prisma } from "@/lib/db";
import { invoiceConfig } from "@/lib/config";
import { logStep } from "@/lib/invoices/audit";
import { claimInvoice, processInvoice, type ProcessOutcome } from "@/lib/invoices/processor";
import { ADMIN_TRANSITIONS, SYSTEM_TRANSITIONS, canTransition } from "@/lib/invoices/transitions";
import { enqueueTask, taskKeys } from "@/lib/agent/tasks";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { AuditResult, AuditStep, ErrorType, InvoiceStatus } from "@/lib/generated/prisma/enums";

// Invoice operations shared by the admin UI (server actions) and the
// CRM API. Every status change is a guarded update on the status we read,
// so two concurrent callers can never both win.

function stuckBefore(): Date {
  return new Date(Date.now() - invoiceConfig().processingTimeoutMinutes * 60_000);
}

export function isStuck(invoice: { status: InvoiceStatus; processingStartedAt: Date | null }): boolean {
  return (
    invoice.status === "PROCESSING" &&
    invoice.processingStartedAt !== null &&
    invoice.processingStartedAt < stuckBefore()
  );
}

export function canRetry(invoice: {
  status: InvoiceStatus;
  retryCount: number;
  processingStartedAt: Date | null;
}): boolean {
  if (isStuck(invoice)) return true;
  return invoice.status === "FAILED" && invoice.retryCount < invoiceConfig().maxRetries;
}

// Which buttons the invoice page offers for this invoice.
export function actionFlags(invoice: {
  status: InvoiceStatus;
  retryCount: number;
  processingStartedAt: Date | null;
}) {
  return {
    canRetry: canRetry(invoice),
    canGenerate: invoice.status === "PENDING",
    manualStatuses: ADMIN_TRANSITIONS[invoice.status].filter(
      (s): s is "PAID" | "CANCELLED" => s === "PAID" || s === "CANCELLED",
    ),
    stuck: isStuck(invoice),
  };
}

// Retry: put a FAILED (under the retry limit) or stuck PROCESSING invoice
// back to PENDING, then run the normal flow on it.
export async function retryInvoice(invoiceId: number, actor: string): Promise<ProcessOutcome> {
  const { maxRetries } = invoiceConfig();
  const before = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!before) return { outcome: "skipped", reason: "Invoice not found" };

  const { count } = await prisma.invoice.updateMany({
    where: {
      id: invoiceId,
      OR: [
        { status: "FAILED", retryCount: { lt: maxRetries } },
        { status: "PROCESSING", processingStartedAt: { lt: stuckBefore() } },
      ],
    },
    data: { status: "PENDING", processingStartedAt: null, nextRetryAt: null },
  });
  if (count === 0) {
    const reason =
      before.status === "FAILED" && before.retryCount >= maxRetries
        ? `Retry limit reached (${before.retryCount} of ${maxRetries})`
        : `Only failed or stuck invoices can be retried (status is ${before.status})`;
    return { outcome: "skipped", reason };
  }

  await logStep({
    invoiceId,
    step: "RETRY",
    result: "SUCCESS",
    message: `Retry requested: ${before.status} → PENDING (attempt ${before.retryCount + 1} of ${maxRetries})`,
    actor,
  });
  return processInvoice(invoiceId, actor);
}

// Generate now: process a PENDING invoice immediately instead of waiting
// for the next scheduled cycle. The claim inside makes it safe to repeat.
export async function generateNow(invoiceId: number, actor: string): Promise<ProcessOutcome> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } });
  if (!invoice) return { outcome: "skipped", reason: "Invoice not found" };
  if (invoice.status !== "PENDING") {
    return { outcome: "skipped", reason: `Only pending invoices can be generated (status is ${invoice.status})` };
  }
  await logStep({
    invoiceId,
    step: "GENERATE_NOW",
    result: "SUCCESS",
    message: "Generate now requested",
    actor,
  });
  return processInvoice(invoiceId, actor);
}

export type StatusChangeResult = { ok: true; from: InvoiceStatus; to: InvoiceStatus } | { ok: false; error: string };

export async function adminSetStatus(
  invoiceId: number,
  to: InvoiceStatus,
  actor: string,
): Promise<StatusChangeResult> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } });
  if (!invoice) return { ok: false, error: "Invoice not found" };
  const from = invoice.status;
  if (!canTransition(ADMIN_TRANSITIONS, from, to)) {
    return { ok: false, error: `Cannot change status from ${from} to ${to}` };
  }
  const { count } = await prisma.invoice.updateMany({
    where: { id: invoiceId, status: from },
    data: {
      status: to,
      ...(to === "CANCELLED" ? { nextRetryAt: null } : {}),
      ...(to === "PAID" ? { paidAt: new Date() } : {}),
    },
  });
  if (count !== 1) return { ok: false, error: "The invoice changed meanwhile; reload and try again" };
  await logStep({
    invoiceId,
    step: "MANUAL_STATUS",
    result: "SUCCESS",
    message: `Status changed by admin: ${from} → ${to}`,
    actor,
  });
  if (to === "PAID") {
    await enqueueTask({ type: "RECEIPT_EMAIL", invoiceId, dedupeKey: taskKeys.receipt(invoiceId) });
  }
  return { ok: true, from, to };
}

export type SystemStatusInput = {
  status: InvoiceStatus;
  gatewayInvoiceId?: string;
  error?: string;
  errorType?: ErrorType;
};

// PATCH /invoices/{id}/status, used by the automation.
export async function systemSetStatus(
  invoiceId: number,
  input: SystemStatusInput,
  actor: string,
): Promise<StatusChangeResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true, gatewayInvoiceId: true, retryCount: true },
  });
  if (!invoice) return { ok: false, error: "Invoice not found" };
  const from = invoice.status;
  const to = input.status;
  if (!canTransition(SYSTEM_TRANSITIONS, from, to)) {
    return { ok: false, error: `Cannot change status from ${from} to ${to}` };
  }
  if (to === "CREATED" && !input.gatewayInvoiceId && !invoice.gatewayInvoiceId) {
    return { ok: false, error: "gatewayInvoiceId is required to mark an invoice CREATED" };
  }
  if (to === "FAILED" && !input.error) {
    return { ok: false, error: "error is required to mark an invoice FAILED" };
  }

  const data: Prisma.InvoiceUpdateManyMutationInput = { status: to };
  if (input.gatewayInvoiceId) data.gatewayInvoiceId = input.gatewayInvoiceId;
  if (to === "FAILED") {
    data.retryCount = { increment: 1 };
    data.lastError = input.error;
    data.errorType = input.errorType ?? "RETRYABLE";
    data.processingStartedAt = null;
  }
  if (to === "CREATED" || to === "PENDING") {
    data.processingStartedAt = null;
  }
  if (to === "SENT") data.sentAt = new Date();
  if (to === "PAID") data.paidAt = new Date();
  if (to === "CREATED") {
    data.lastError = null;
    data.errorType = null;
    data.nextRetryAt = null;
  }

  try {
    const { count } = await prisma.invoice.updateMany({ where: { id: invoiceId, status: from }, data });
    if (count !== 1) return { ok: false, error: "The invoice changed meanwhile; read it again" };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return { ok: false, error: "gatewayInvoiceId is already used by another invoice" };
    }
    throw err;
  }
  await logStep({
    invoiceId,
    step: "STATUS_UPDATE",
    result: "SUCCESS",
    message: `${from} → ${to}${input.error ? `: ${input.error}` : ""}`,
    actor,
    metadata: { gatewayInvoiceId: input.gatewayInvoiceId ?? null, errorType: input.errorType ?? null },
  });
  if (to === "CREATED") {
    await enqueueTask({ type: "INVOICE_EMAIL", invoiceId, dedupeKey: taskKeys.invoiceEmail(invoiceId) });
  }
  if (to === "PAID") {
    await enqueueTask({ type: "RECEIPT_EMAIL", invoiceId, dedupeKey: taskKeys.receipt(invoiceId) });
  }
  if (to === "FAILED") {
    const attempt = invoice.retryCount + 1;
    if (input.errorType === "PERMANENT" || attempt >= invoiceConfig().maxRetries) {
      await enqueueTask({ type: "ADMIN_ALERT", invoiceId, dedupeKey: taskKeys.alert(invoiceId, attempt) });
    }
  }
  return { ok: true, from, to };
}

// POST /invoices/{id}/claim
export async function apiClaim(invoiceId: number, actor: string) {
  const exists = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } });
  if (!exists) return { found: false as const };
  const claimedAt = await claimInvoice(invoiceId, actor);
  return { found: true as const, claimed: claimedAt !== null };
}

// POST /invoices/{id}/log
export async function appendLog(
  invoiceId: number,
  entry: { step?: AuditStep; result: AuditResult; message: string; metadata?: Prisma.InputJsonValue },
  actor: string,
): Promise<boolean> {
  const exists = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } });
  if (!exists) return false;
  await logStep({ invoiceId, step: entry.step ?? "API_LOG", actor, ...entry });
  return true;
}

// GET /invoices/due: what a processing cycle should pick up. An invoice is
// due once its issue time falls in the window. With the default statuses
// this also returns failed invoices that may be retried now and invoices
// stuck in PROCESSING longer than the timeout.
export async function dueInvoices(params: { from: Date; to: Date; statuses: InvoiceStatus[] }) {
  const { maxRetries } = invoiceConfig();
  const or: Prisma.InvoiceWhereInput[] = [];
  for (const status of params.statuses) {
    if (status === "FAILED") {
      or.push({
        status: "FAILED",
        retryCount: { lt: maxRetries },
        errorType: "RETRYABLE",
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: params.to } }],
      });
    } else if (status === "PROCESSING") {
      or.push({ status: "PROCESSING", processingStartedAt: { lt: stuckBefore() } });
    } else {
      or.push({ status });
    }
  }
  return prisma.invoice.findMany({
    where: { issueAt: { gte: params.from, lte: params.to }, OR: or },
    orderBy: [{ issueAt: "asc" }, { id: "asc" }],
    include: { client: true, lineItems: true, taxes: true },
  });
}
