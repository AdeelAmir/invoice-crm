import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { invoiceConfig } from "@/lib/config";
import { toCents } from "@/lib/money";
import { GatewayError, createGatewayInvoice } from "@/lib/gateway/mock";
import { logStep } from "@/lib/invoices/audit";
import { nextOccurrence, ruleAllowsNext } from "@/lib/invoices/recurrence";
import { retryDelaySeconds } from "@/lib/invoices/transitions";
import { enqueueTask, taskKeys } from "@/lib/agent/tasks";
import type { ErrorType } from "@/lib/generated/prisma/enums";

// The documented invoicing flow, one invoice at a time:
//   1. claim it (PENDING -> PROCESSING, atomic; skip if the claim fails)
//   2. create it in the payment gateway, keyed on the CRM invoice id
//   3. mark it CREATED with the gateway invoice id
//   4. (send to the client: out of scope for the demo)
//   5. log every step
// then, for a recurring invoice, generate the next occurrence.
//
// After the claim, every write is guarded on (status = PROCESSING and
// processingStartedAt = our claim time). If a stuck invoice was reset and
// claimed again in the meantime, the stale run can no longer touch it.

export type ProcessOutcome =
  | { outcome: "created"; gatewayInvoiceId: string; replayed: boolean; nextInvoiceId: number | null }
  | {
      outcome: "failed";
      error: string;
      errorType: ErrorType;
      retryCount: number;
      retryLimitReached: boolean;
    }
  | { outcome: "skipped"; reason: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function invoiceNumberFor(id: number): string {
  return `INV-${String(id).padStart(5, "0")}`;
}

export async function claimInvoice(invoiceId: number, actor: string): Promise<Date | null> {
  const claimedAt = new Date();
  const { count } = await prisma.invoice.updateMany({
    where: { id: invoiceId, status: "PENDING" },
    data: { status: "PROCESSING", processingStartedAt: claimedAt },
  });
  await logStep({
    invoiceId,
    step: "CLAIM",
    result: count === 1 ? "SUCCESS" : "FAILURE",
    message:
      count === 1
        ? "Claimed: PENDING → PROCESSING"
        : "Claim refused: the invoice is not PENDING (already claimed or processed)",
    actor,
  });
  return count === 1 ? claimedAt : null;
}

type LoadedInvoice = NonNullable<Awaited<ReturnType<typeof loadInvoice>>>;

function loadInvoice(invoiceId: number) {
  return prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { client: true, lineItems: true, taxes: true, recurringRule: true },
  });
}

// Permanent problems: retrying cannot help until someone fixes the data.
function dataProblem(invoice: LoadedInvoice): string | null {
  if (!invoice.client.isActive) return "Client is deactivated";
  if (!EMAIL_RE.test(invoice.client.email)) return `Invalid client email "${invoice.client.email}"`;
  if (invoice.lineItems.length === 0) return "Invoice has no line items";
  if (toCents(invoice.total) <= 0) return "Invoice total must be greater than zero";
  if (!/^[A-Z]{3}$/.test(invoice.currency)) return `Invalid currency "${invoice.currency}"`;
  return null;
}

export async function processInvoice(invoiceId: number, actor: string): Promise<ProcessOutcome> {
  const exists = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } });
  if (!exists) return { outcome: "skipped", reason: "Invoice not found" };

  const claimedAt = await claimInvoice(invoiceId, actor);
  if (!claimedAt) {
    return { outcome: "skipped", reason: "Invoice is already being processed or is not pending" };
  }
  const owned = { id: invoiceId, status: "PROCESSING" as const, processingStartedAt: claimedAt };

  const invoice = (await loadInvoice(invoiceId))!;

  try {
    const problem = dataProblem(invoice);
    if (problem) throw new GatewayError(problem, false, "INVALID_DATA");

    const gateway = await createGatewayInvoice({
      idempotencyKey: `crm-invoice-${invoice.id}`,
      amountCents: toCents(invoice.total),
      currency: invoice.currency,
      simulateTimeout: invoice.simulateFailure === "TIMEOUT" && invoice.retryCount === 0,
    });
    await logStep({
      invoiceId,
      step: "GATEWAY_CREATE",
      result: "SUCCESS",
      message: gateway.replayed
        ? `Gateway returned the existing invoice ${gateway.gatewayId} (idempotent replay)`
        : `Gateway invoice ${gateway.gatewayId} created`,
      actor,
      metadata: { gatewayInvoiceId: gateway.gatewayId, replayed: gateway.replayed },
    });

    const { count } = await prisma.invoice.updateMany({
      where: owned,
      data: {
        status: "CREATED",
        gatewayInvoiceId: gateway.gatewayId,
        lastError: null,
        errorType: null,
        nextRetryAt: null,
        processingStartedAt: null,
      },
    });
    if (count !== 1) {
      await logStep({
        invoiceId,
        step: "STATUS_UPDATE",
        result: "FAILURE",
        message: "Status not updated: this run no longer owns the invoice",
        actor,
      });
      return { outcome: "skipped", reason: "Another run took over this invoice" };
    }
    await logStep({
      invoiceId,
      step: "STATUS_UPDATE",
      result: "SUCCESS",
      message: "PROCESSING → CREATED",
      actor,
    });
    // The agent writes and sends the invoice email.
    await enqueueTask({ type: "INVOICE_EMAIL", invoiceId, dedupeKey: taskKeys.invoiceEmail(invoiceId) });

    const nextInvoiceId = await generateNextOccurrence(invoice, actor);
    return {
      outcome: "created",
      gatewayInvoiceId: gateway.gatewayId,
      replayed: gateway.replayed,
      nextInvoiceId,
    };
  } catch (err) {
    return recordFailure(invoice, owned, err, actor);
  }
}

async function recordFailure(
  invoice: LoadedInvoice,
  owned: { id: number; status: "PROCESSING"; processingStartedAt: Date },
  err: unknown,
  actor: string,
): Promise<ProcessOutcome> {
  const { maxRetries, retryBaseSeconds } = invoiceConfig();
  // Anything that is not a known gateway error (network, DB hiccup) is
  // treated as temporary.
  const failure =
    err instanceof GatewayError
      ? err
      : new GatewayError(err instanceof Error ? err.message : "Unexpected error", true, "UNEXPECTED");
  const errorType: ErrorType = failure.retryable ? "RETRYABLE" : "PERMANENT";
  const retryCount = invoice.retryCount + 1;
  const retryLimitReached = retryCount >= maxRetries;
  const nextRetryAt =
    failure.retryable && !retryLimitReached
      ? new Date(Date.now() + retryDelaySeconds(retryCount, retryBaseSeconds) * 1000)
      : null;

  await logStep({
    invoiceId: invoice.id,
    step: "GATEWAY_CREATE",
    result: "FAILURE",
    message: `${failure.message} [${failure.code}]`,
    actor,
    metadata: { code: failure.code, errorType },
  });

  const { count } = await prisma.invoice.updateMany({
    where: owned,
    data: {
      status: "FAILED",
      retryCount: { increment: 1 },
      lastError: failure.message,
      errorType,
      nextRetryAt,
      processingStartedAt: null,
    },
  });
  if (count !== 1) {
    return { outcome: "skipped", reason: "Another run took over this invoice" };
  }

  const notes = [`PROCESSING → FAILED (${errorType}, attempt ${retryCount} of ${maxRetries})`];
  if (errorType === "PERMANENT") notes.push("admin alert raised: the data must be fixed before a retry");
  if (retryLimitReached) notes.push("retry limit reached: developer alert raised");
  else if (nextRetryAt) notes.push(`next automatic retry after ${nextRetryAt.toISOString()}`);
  await logStep({
    invoiceId: invoice.id,
    step: "STATUS_UPDATE",
    result: "SUCCESS",
    message: notes.join("; "),
    actor,
    metadata: { retryCount, retryLimitReached, nextRetryAt: nextRetryAt?.toISOString() ?? null },
  });
  if (errorType === "PERMANENT" || retryLimitReached) {
    await enqueueTask({ type: "ADMIN_ALERT", invoiceId: invoice.id, dedupeKey: taskKeys.alert(invoice.id, retryCount) });
  }

  return { outcome: "failed", error: failure.message, errorType, retryCount, retryLimitReached };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

// After an occurrence reaches CREATED, add the next one from the recurrence
// rule. Safe to repeat: parentInvoiceId is unique, so an occurrence can
// only ever have one successor.
async function generateNextOccurrence(invoice: LoadedInvoice, actor: string): Promise<number | null> {
  if (!invoice.recurringRuleId) return null;

  const existing = await prisma.invoice.findUnique({
    where: { parentInvoiceId: invoice.id },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    return await prisma.$transaction(async (tx) => {
      const rule = await tx.recurringRule.findUniqueOrThrow({ where: { id: invoice.recurringRuleId! } });
      const nextIssueAt = nextOccurrence(invoice.issueAt, rule.frequency, invoice.client.timezone);
      if (rule.stoppedAt || !ruleAllowsNext(rule, nextIssueAt)) {
        await logStep(
          {
            invoiceId: invoice.id,
            step: "RECURRING_NEXT",
            result: "SUCCESS",
            message: rule.stoppedAt
              ? "Billing plan was changed or stopped: no further occurrence"
              : "Recurring schedule complete: no further occurrence",
            actor,
          },
          tx,
        );
        return null;
      }

      const termMs = invoice.dueAt.getTime() - invoice.issueAt.getTime();
      const created = await tx.invoice.create({
        data: {
          invoiceNumber: `TMP-${randomUUID()}`,
          clientId: invoice.clientId,
          currency: invoice.currency,
          subtotal: invoice.subtotal,
          taxTotal: invoice.taxTotal,
          total: invoice.total,
          issueAt: nextIssueAt,
          dueAt: new Date(nextIssueAt.getTime() + termMs),
          paymentTerms: invoice.paymentTerms,
          type: "RECURRING",
          status: "PENDING",
          recurringRuleId: rule.id,
          parentInvoiceId: invoice.id,
          fromClientPlan: invoice.fromClientPlan,
          lineItems: {
            create: invoice.lineItems.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
              position: l.position,
            })),
          },
          taxes: {
            create: invoice.taxes.map((t) => ({ name: t.name, rate: t.rate, amount: t.amount })),
          },
        },
      });
      const number = invoiceNumberFor(created.id);
      await tx.invoice.update({ where: { id: created.id }, data: { invoiceNumber: number } });
      await tx.recurringRule.update({
        where: { id: rule.id },
        data: { generatedCount: { increment: 1 } },
      });
      await logStep(
        {
          invoiceId: invoice.id,
          step: "RECURRING_NEXT",
          result: "SUCCESS",
          message: `Next occurrence ${number} generated (issue ${nextIssueAt.toISOString()})`,
          actor,
          metadata: { nextInvoiceId: created.id },
        },
        tx,
      );
      await logStep(
        {
          invoiceId: created.id,
          step: "RECURRING_NEXT",
          result: "SUCCESS",
          message: `Generated from ${invoice.invoiceNumber} by the ${rule.frequency.toLowerCase()} schedule`,
          actor,
          metadata: { parentInvoiceId: invoice.id },
        },
        tx,
      );
      return created.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await prisma.invoice.findUnique({
        where: { parentInvoiceId: invoice.id },
        select: { id: true },
      });
      return winner?.id ?? null;
    }
    // The invoice itself is CREATED; a failed rollover must not undo that.
    await logStep({
      invoiceId: invoice.id,
      step: "RECURRING_NEXT",
      result: "FAILURE",
      message: `Could not generate the next occurrence: ${err instanceof Error ? err.message : "unknown error"}`,
      actor,
    });
    return null;
  }
}
