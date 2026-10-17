import { prisma } from "@/lib/db";
import { agentConfig } from "@/lib/config";
import { logStep } from "@/lib/invoices/audit";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { AgentTaskType, InvoiceStatus } from "@/lib/generated/prisma/enums";

// The agent's work queue. CRM code enqueues (invoice created, paid, client
// replied, ...); the runner claims one task at a time, runs it, and reports
// back. Enqueueing is idempotent on dedupeKey; claiming is a guarded update.

type Db = typeof prisma | Prisma.TransactionClient;

export const taskKeys = {
  invoiceEmail: (invoiceId: number) => `invoice-email:${invoiceId}`,
  receipt: (invoiceId: number) => `receipt:${invoiceId}`,
  reminder: (invoiceId: number, n: number) => `reminder:${invoiceId}:${n}`,
  reply: (messageId: number) => `reply:${messageId}`,
  alert: (invoiceId: number, attempt: number) => `alert:${invoiceId}:${attempt}`,
};

export async function enqueueTask(
  task: { type: AgentTaskType; invoiceId: number; dedupeKey: string; payload?: Prisma.InputJsonValue },
  db: Db = prisma,
): Promise<boolean> {
  const { count } = await db.agentTask.createMany({ data: [task], skipDuplicates: true });
  return count === 1;
}

// A task whose invoice moved on (cancelled, already paid, ...) is closed
// as skipped instead of being handed to the agent.
function skipReason(type: AgentTaskType, status: InvoiceStatus): string | null {
  const needs: Partial<Record<AgentTaskType, InvoiceStatus>> = {
    INVOICE_EMAIL: "CREATED",
    RECEIPT_EMAIL: "PAID",
    REMINDER_EMAIL: "SENT",
  };
  const required = needs[type];
  return required && status !== required ? `invoice is ${status}, not ${required}` : null;
}

export type ClaimedTask = NonNullable<Awaited<ReturnType<typeof loadTask>>>;

function loadTask(id: number) {
  return prisma.agentTask.findUnique({
    where: { id },
    include: {
      invoice: { select: { id: true, invoiceNumber: true, status: true, agentSessionId: true } },
    },
  });
}

// Give RUNNING tasks whose runner died back to the queue (or fail them once
// they are out of attempts).
async function releaseStale() {
  const { taskTimeoutMinutes, taskMaxAttempts } = agentConfig();
  const cutoff = new Date(Date.now() - taskTimeoutMinutes * 60_000);
  await prisma.agentTask.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff }, attempts: { gte: taskMaxAttempts } },
    data: { status: "FAILED", lastError: "Timed out while running", finishedAt: new Date() },
  });
  await prisma.agentTask.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data: { status: "PENDING", lastError: "Timed out while running; requeued" },
  });
}

export async function claimNextTask(): Promise<ClaimedTask | null> {
  await releaseStale();
  for (let i = 0; i < 50; i++) {
    const next = await prisma.agentTask.findFirst({
      where: { status: "PENDING" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { invoice: { select: { status: true } } },
    });
    if (!next) return null;

    const skip = skipReason(next.type, next.invoice.status);
    if (skip) {
      await prisma.agentTask.updateMany({
        where: { id: next.id, status: "PENDING" },
        data: { status: "DONE", result: `Skipped: ${skip}`, finishedAt: new Date() },
      });
      continue;
    }
    const { count } = await prisma.agentTask.updateMany({
      where: { id: next.id, status: "PENDING" },
      data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: new Date() },
    });
    if (count === 1) return loadTask(next.id);
  }
  return null;
}

export type TaskUpdate = { ok: true; status: "DONE" | "PENDING" | "FAILED" } | { ok: false; error: string };

export async function completeTask(taskId: number, result: string, actor: string): Promise<TaskUpdate> {
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, error: "Task not found" };
  const { count } = await prisma.agentTask.updateMany({
    where: { id: taskId, status: "RUNNING" },
    data: { status: "DONE", result: result.slice(0, 2000), lastError: null, finishedAt: new Date() },
  });
  if (count !== 1) return { ok: false, error: `Task is ${task.status}, not RUNNING` };
  await logStep({
    invoiceId: task.invoiceId,
    step: "AGENT_TASK",
    result: "SUCCESS",
    message: `Agent task ${task.type} done: ${result.slice(0, 300)}`,
    actor,
    metadata: { taskId },
  });
  return { ok: true, status: "DONE" };
}

// A failed run goes back to the queue until it is out of attempts.
export async function failTask(taskId: number, error: string, actor: string): Promise<TaskUpdate> {
  const { taskMaxAttempts } = agentConfig();
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, error: "Task not found" };
  const status = task.attempts >= taskMaxAttempts ? "FAILED" : "PENDING";
  const { count } = await prisma.agentTask.updateMany({
    where: { id: taskId, status: "RUNNING" },
    data: {
      status,
      lastError: error.slice(0, 2000),
      finishedAt: status === "FAILED" ? new Date() : null,
    },
  });
  if (count !== 1) return { ok: false, error: `Task is ${task.status}, not RUNNING` };
  await logStep({
    invoiceId: task.invoiceId,
    step: "AGENT_TASK",
    result: "FAILURE",
    message: `Agent task ${task.type} failed (attempt ${task.attempts} of ${taskMaxAttempts})${
      status === "PENDING" ? ", will retry" : ""
    }: ${error.slice(0, 300)}`,
    actor,
    metadata: { taskId },
  });
  return { ok: true, status };
}
