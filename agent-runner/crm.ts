import type { RunnerConfig } from "./config";

// Minimal client for the CRM's /api/agent routes (x-api-key auth).
// 2xx, 400, 404 and 409 come back as data: they are answers the agent or
// the runner acts on. Network errors, 401 and 5xx throw.

export type CrmResponse<T> = { status: number; data: T };

export class CrmClient {
  constructor(private readonly cfg: RunnerConfig) {}

  async call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<CrmResponse<T>> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.crmBaseUrl}${path}`, {
        method,
        headers: { "x-api-key": this.cfg.crmApiKey, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Cannot reach the CRM at ${this.cfg.crmBaseUrl} (${err instanceof Error ? err.message : err}). Is \`npm run dev\` running?`,
      );
    }
    const data = (await res.json().catch(() => ({}))) as T;
    if (res.status === 401) throw new Error("The CRM rejected CRM_API_KEY (401). Check .env.");
    if (res.status >= 500) throw new Error(`CRM ${method} ${path} failed with ${res.status}: ${JSON.stringify(data)}`);
    return { status: res.status, data };
  }
}

export type TaskType = "INVOICE_EMAIL" | "RECEIPT_EMAIL" | "REMINDER_EMAIL" | "CLIENT_REPLY" | "ADMIN_ALERT";

export type AgentTask = {
  id: number;
  type: TaskType;
  invoiceId: number;
  payload: { reminderNumber?: number; messageId?: number } | null;
  attempts: number;
  invoice: { id: number; invoiceNumber: string; status: string; agentSessionId: string | null };
};

export type InvoiceContext = {
  business: string;
  invoice: {
    id: number;
    number: string;
    status: string;
    remindersSent: number;
    needsAttention: boolean;
    [key: string]: unknown;
  };
  client: { name: string; email: string };
  conversation: { messageId: number; from: string; kind: string; subject: string; body: string; at: string }[];
};
