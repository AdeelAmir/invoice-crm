import { z } from "zod";
import type { CrmClient } from "./crm";

// Handlers for the agent's custom tools. Each one calls the CRM, which
// enforces the rules (recipient, invoice state, one email per kind). The
// result text goes back to the agent as the tool result.

const id = z.number().int().positive();
const email = z.object({ invoice_id: id, subject: z.string().min(1).max(200), body: z.string().min(1).max(10_000) });

const schemas = {
  get_invoice: z.object({ invoice_id: id }),
  send_invoice_email: email,
  send_receipt_email: email,
  send_reminder_email: email,
  reply_to_client: email,
  escalate_to_admin: z.object({
    invoice_id: id,
    category: z.enum(["DISPUTE", "REFUND", "OTHER"]),
    summary: z.string().min(1).max(2000),
    client_request: z.string().max(2000).optional(),
    recommended_action: z.string().max(2000).optional(),
  }),
};

type ToolName = keyof typeof schemas;

const EMAIL_KIND = {
  send_invoice_email: "INVOICE",
  send_receipt_email: "RECEIPT",
  send_reminder_email: "REMINDER",
  reply_to_client: "REPLY",
} as const;

function isToolName(name: string): name is ToolName {
  return name in schemas;
}

/** Runs one tool call for the session that handles `invoiceId`. */
export async function runTool(crm: CrmClient, invoiceId: number, name: string, rawInput: unknown): Promise<string> {
  if (!isToolName(name)) return `Error: unknown tool "${name}".`;
  const parsed = schemas[name].safeParse(rawInput);
  if (!parsed.success) {
    return `Error: invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
  }
  const input = parsed.data;
  // A session only ever acts on its own invoice, whatever a message says.
  if (input.invoice_id !== invoiceId) {
    return `Error: this conversation is about invoice ${invoiceId}; you cannot act on invoice ${input.invoice_id}.`;
  }

  if (name === "get_invoice") {
    const r = await crm.call<{ context?: unknown; error?: string }>("GET", `/api/agent/invoices/${invoiceId}/context`);
    return r.status === 200 ? JSON.stringify(r.data.context, null, 2) : `Error: ${r.data.error ?? r.status}`;
  }

  if (name === "escalate_to_admin") {
    const e = input as z.infer<typeof schemas.escalate_to_admin>;
    const r = await crm.call<{ ok?: boolean; message?: string; error?: string }>(
      "POST",
      `/api/agent/invoices/${invoiceId}/escalate`,
      { category: e.category, summary: e.summary, clientRequest: e.client_request, recommendedAction: e.recommended_action },
    );
    return r.data.ok ? `OK: ${r.data.message}` : `Error: ${r.data.error ?? r.status}`;
  }

  const e = input as z.infer<typeof email>;
  const r = await crm.call<{ ok?: boolean; message?: string; error?: string; alreadySent?: boolean }>(
    "POST",
    `/api/agent/invoices/${invoiceId}/emails`,
    { kind: EMAIL_KIND[name], subject: e.subject, body: e.body },
  );
  if (r.data.ok) return r.data.alreadySent ? `Already sent earlier: ${r.data.message}` : `OK: ${r.data.message}`;
  return `Not sent: ${r.data.error ?? `HTTP ${r.status}`}`;
}
