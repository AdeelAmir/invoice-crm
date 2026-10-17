import { describe, expect, it } from "vitest";
import { runTool } from "@/agent-runner/tools";
import type { CrmClient } from "@/agent-runner/crm";

// The runner's tool handlers: input validation and the one-invoice guard
// run before anything reaches the CRM.

function fakeCrm() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const crm = {
    async call(method: string, path: string, body?: unknown) {
      calls.push({ method, path, body });
      return { status: 200, data: { ok: true, message: "sent", context: { invoice: { id: 7 } } } };
    },
  } as unknown as CrmClient;
  return { crm, calls };
}

describe("runTool", () => {
  it("refuses to act on a different invoice than the session's", async () => {
    const { crm, calls } = fakeCrm();
    const r = await runTool(crm, 7, "send_invoice_email", { invoice_id: 8, subject: "s", body: "b" });
    expect(r).toMatch(/about invoice 7/);
    expect(calls).toHaveLength(0);
  });

  it("rejects unknown tools and invalid input without calling the CRM", async () => {
    const { crm, calls } = fakeCrm();
    expect(await runTool(crm, 7, "delete_invoice", { invoice_id: 7 })).toMatch(/unknown tool/);
    expect(await runTool(crm, 7, "escalate_to_admin", { invoice_id: 7, category: "MAYBE", summary: "x" })).toMatch(/invalid input/);
    expect(calls).toHaveLength(0);
  });

  it("maps each email tool to its kind and the escalation fields to the API's", async () => {
    const { crm, calls } = fakeCrm();
    await runTool(crm, 7, "reply_to_client", { invoice_id: 7, subject: "Re", body: "Hi" });
    await runTool(crm, 7, "escalate_to_admin", { invoice_id: 7, category: "REFUND", summary: "s", client_request: "c" });
    expect(calls).toEqual([
      { method: "POST", path: "/api/agent/invoices/7/emails", body: { kind: "REPLY", subject: "Re", body: "Hi" } },
      {
        method: "POST",
        path: "/api/agent/invoices/7/escalate",
        body: { category: "REFUND", summary: "s", clientRequest: "c", recommendedAction: undefined },
      },
    ]);
  });
});
