import Anthropic from "@anthropic-ai/sdk";
import { consoleUrl, type RunnerConfig } from "./config";
import type { CrmClient } from "./crm";
import { runTool } from "./tools";

// One Managed Agent session per invoice: the invoice email, the client's
// replies and the receipt all happen in the same conversation, so the agent
// remembers what it already wrote.

export type TurnResult = { finalText: string; toolCalls: string[] };

export class AgentSessions {
  private readonly client = new Anthropic(); // ANTHROPIC_API_KEY from .env

  constructor(
    private readonly cfg: RunnerConfig,
    private readonly crm: CrmClient,
  ) {}

  /** The invoice's session, created (and saved in the CRM) when it has none or it ended. */
  async ensureSession(invoiceId: number, invoiceNumber: string, existing: string | null): Promise<string> {
    if (existing) {
      try {
        const s = await this.client.beta.sessions.retrieve(existing);
        if (s.status !== "terminated") return existing;
        console.log(`  session ${existing} has ended; starting a new one`);
      } catch (err) {
        if (!(err instanceof Anthropic.NotFoundError)) throw err;
        console.log(`  session ${existing} no longer exists; starting a new one`);
      }
    }
    const session = await this.client.beta.sessions.create({
      agent: this.cfg.agentId,
      environment_id: this.cfg.environmentId,
      title: `Invoice ${invoiceNumber}`,
      budget: { type: "limit", max_list_cost: { amount: String(this.cfg.sessionBudgetCents), currency: "USD" } },
    });
    const saved = await this.crm.call("PUT", `/api/agent/invoices/${invoiceId}/session`, { sessionId: session.id });
    if (saved.status !== 200) throw new Error(`Could not save the session id on invoice ${invoiceId}`);
    console.log(`  new session ${session.id}`);
    return session.id;
  }

  /**
   * A runner that died mid-task can leave a tool call unanswered, which
   * blocks the session (a new message is rejected). Answer those first.
   */
  private async settlePending(sessionId: string, invoiceId: number) {
    const calls = new Map<string, { name: string; input: unknown }>();
    const answered = new Set<string>();
    for await (const event of this.client.beta.sessions.events.list(sessionId)) {
      if (event.type === "agent.custom_tool_use") calls.set(event.id, { name: event.name, input: event.input });
      if (event.type === "user.custom_tool_result") answered.add(event.custom_tool_use_id);
    }
    for (const [id, call] of calls) {
      if (answered.has(id)) continue;
      console.log(`  answering a tool call left over from an earlier run: ${call.name}`);
      const text = await runTool(this.crm, invoiceId, call.name, call.input);
      await this.client.beta.sessions.events.send(sessionId, {
        events: [{ type: "user.custom_tool_result", custom_tool_use_id: id, content: [{ type: "text", text }] }],
      });
    }
  }

  /** Sends one task message and serves the agent's tool calls until it finishes. */
  async runTurn(sessionId: string, invoiceId: number, message: string): Promise<TurnResult> {
    await this.settlePending(sessionId, invoiceId);
    console.log(`  watch live: ${consoleUrl(this.cfg, sessionId)}`);

    // Stream first, then send, so no event is missed.
    const stream = await this.client.beta.sessions.events.stream(sessionId);
    const timer = setTimeout(() => {
      void this.client.beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }] }).catch(() => {});
      stream.controller.abort();
    }, this.cfg.turnTimeoutMs);

    const texts: string[] = [];
    const toolCalls: string[] = [];
    let started = false;
    let error: string | null = null;
    try {
      await this.client.beta.sessions.events.send(sessionId, {
        events: [{ type: "user.message", content: [{ type: "text", text: message }] }],
      });

      for await (const event of stream) {
        switch (event.type) {
          case "user.message":
          case "session.status_running":
            started = true;
            break;
          case "agent.message":
            for (const block of event.content) {
              if (block.type === "text") {
                texts.push(block.text);
                console.log(`  agent: ${block.text.replace(/\s+/g, " ").slice(0, 200)}`);
              }
            }
            break;
          case "agent.custom_tool_use": {
            started = true;
            const text = await runTool(this.crm, invoiceId, event.name, event.input);
            toolCalls.push(`${event.name} -> ${text.split("\n")[0].slice(0, 120)}`);
            console.log(`  tool ${event.name}: ${text.split("\n")[0].slice(0, 160)}`);
            await this.client.beta.sessions.events.send(sessionId, {
              events: [{ type: "user.custom_tool_result", custom_tool_use_id: event.id, content: [{ type: "text", text }] }],
            });
            break;
          }
          case "agent.tool_use":
          case "agent.mcp_tool_use":
            // This agent has no built-in or MCP tools; refuse anything that asks.
            if (event.evaluated_permission === "ask") {
              await this.client.beta.sessions.events.send(sessionId, {
                events: [{ type: "user.tool_confirmation", tool_use_id: event.id, result: "deny" }],
              });
            }
            break;
          case "session.error":
            error = JSON.stringify(event).slice(0, 500);
            console.log(`  session error: ${error}`);
            break;
          case "session.status_terminated":
            throw new Error(`The session ended unexpectedly${error ? `: ${error}` : ""}`);
          case "session.status_idle": {
            if (!started) break; // an idle from before our message
            const reason = event.stop_reason.type;
            if (reason === "requires_action") break; // waiting on a tool result we are sending
            if (reason === "budget_reached") {
              throw new Error(
                `The session reached its budget ($${(this.cfg.sessionBudgetCents / 100).toFixed(2)}). Raise it in the Console or AGENT_SESSION_BUDGET_CENTS.`,
              );
            }
            return { finalText: texts.join("\n").trim(), toolCalls };
          }
        }
      }
      throw new Error(
        stream.controller.signal.aborted
          ? `The agent did not finish within ${this.cfg.turnTimeoutMs / 60_000} minutes`
          : "The event stream closed before the agent finished",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
