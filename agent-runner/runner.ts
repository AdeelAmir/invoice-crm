import type { RunnerConfig } from "./config";
import type { AgentTask, CrmClient, InvoiceContext } from "./crm";
import { AgentSessions } from "./session";

// Runs CRM agent tasks: claim one, hand it to the agent (or to CRM code
// for ADMIN_ALERT), check the agent really did it, report back.

function kickoff(task: AgentTask): string {
  const inv = `invoice ${task.invoice.invoiceNumber} (invoice_id ${task.invoiceId})`;
  switch (task.type) {
    case "INVOICE_EMAIL":
      return `Task: ${inv} has just been created. Write the invoice email to the client and send it with send_invoice_email.`;
    case "RECEIPT_EMAIL":
      return `Task: ${inv} has been paid. Write a short thank-you receipt email and send it with send_receipt_email.`;
    case "REMINDER_EMAIL":
      return `Task: payment for ${inv} is overdue. Write overdue reminder number ${task.payload?.reminderNumber ?? 1} and send it with send_reminder_email.`;
    case "CLIENT_REPLY":
      return (
        `Task: the client replied about ${inv} (message id ${task.payload?.messageId}). ` +
        "Read it with get_invoice, then answer it with reply_to_client, or escalate_to_admin first if it needs a person."
      );
    case "ADMIN_ALERT":
      return "";
  }
}

// The agent saying it is done is not proof: check the CRM for the email.
function verify(task: AgentTask, ctx: InvoiceContext): string | null {
  const sent = (kind: string, afterId = 0) =>
    ctx.conversation.some((m) => m.from === "us" && m.kind === kind && m.messageId > afterId);
  switch (task.type) {
    case "INVOICE_EMAIL":
      return sent("INVOICE") ? null : "the agent finished without sending the invoice email";
    case "RECEIPT_EMAIL":
      return sent("RECEIPT") ? null : "the agent finished without sending the receipt";
    case "REMINDER_EMAIL":
      return ctx.invoice.remindersSent >= (task.payload?.reminderNumber ?? 1)
        ? null
        : "the agent finished without sending the reminder";
    case "CLIENT_REPLY":
      return sent("REPLY", task.payload?.messageId ?? 0) || ctx.invoice.needsAttention
        ? null
        : "the agent finished without replying to the client or escalating";
    case "ADMIN_ALERT":
      return null;
  }
}

export class TaskRunner {
  private readonly sessions: AgentSessions;

  constructor(
    cfg: RunnerConfig,
    private readonly crm: CrmClient,
  ) {
    this.sessions = new AgentSessions(cfg, crm);
  }

  async enqueueReminders(): Promise<number> {
    const r = await this.crm.call<{ queued: number }>("POST", "/api/agent/reminders/enqueue");
    return r.data.queued ?? 0;
  }

  /**
   * The invoicing schedule (plain code, no agent): process every PENDING
   * invoice whose issue time has come, and retry failed (backoff passed) or
   * stuck ones. A created invoice queues its email task in the CRM; a
   * permanent failure queues the admin alert.
   */
  async processDueInvoices(): Promise<{ created: number; failed: number }> {
    const to = new Date();
    const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
    const due = await this.crm.call<{ invoices?: { id: number; invoiceNumber: string; status: string }[] }>(
      "GET",
      `/api/invoices/due?from=${from.toISOString()}&to=${to.toISOString()}`,
    );
    let created = 0;
    let failed = 0;
    for (const inv of due.data.invoices ?? []) {
      const action = inv.status === "PENDING" ? "process" : "retry";
      const r = await this.crm.call<{ outcome?: string; error?: string }>("POST", `/api/invoices/${inv.id}/${action}`);
      if (r.data.outcome === "created") created++;
      if (r.data.outcome === "failed") failed++;
      if (r.data.outcome) console.log(`  ${action} ${inv.invoiceNumber}: ${r.data.outcome}${r.data.error ? ` (${r.data.error})` : ""}`);
    }
    return { created, failed };
  }

  /** Claims and runs one task. Returns false when the queue is empty. */
  async runNext(): Promise<boolean> {
    const claim = await this.crm.call<{ task: AgentTask | null }>("POST", "/api/agent/tasks/claim");
    const task = claim.data.task;
    if (!task) return false;

    console.log(`\n▶ task #${task.id} ${task.type} for ${task.invoice.invoiceNumber} (try ${task.attempts})`);
    try {
      if (task.type === "ADMIN_ALERT") {
        const r = await this.crm.call<{ ok: boolean; message?: string; error?: string }>(
          "POST",
          `/api/agent/tasks/${task.id}/execute`,
        );
        console.log(r.data.ok ? `✔ ${r.data.message}` : `✖ ${r.data.error}`);
        return true;
      }

      const before = await this.crm.call<{ agentSessionId: string | null }>(
        "GET",
        `/api/agent/invoices/${task.invoiceId}/context`,
      );
      if (before.status !== 200) throw new Error(`Invoice ${task.invoiceId} not found`);
      const sessionId = await this.sessions.ensureSession(
        task.invoiceId,
        task.invoice.invoiceNumber,
        before.data.agentSessionId,
      );
      const turn = await this.sessions.runTurn(sessionId, task.invoiceId, kickoff(task));

      const after = await this.crm.call<{ context: InvoiceContext }>("GET", `/api/agent/invoices/${task.invoiceId}/context`);
      const problem = verify(task, after.data.context);
      if (problem) throw new Error(problem);

      const result = turn.finalText.split("\n").at(-1) || turn.toolCalls.join("; ") || "done";
      await this.crm.call("POST", `/api/agent/tasks/${task.id}/complete`, { result });
      console.log(`✔ task #${task.id} done`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const r = await this.crm.call<{ status?: string }>("POST", `/api/agent/tasks/${task.id}/fail`, { error: message });
      console.log(`✖ task #${task.id} failed: ${message}${r.data.status === "PENDING" ? " (will retry)" : ""}`);
    }
    return true;
  }
}
