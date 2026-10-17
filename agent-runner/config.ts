import "dotenv/config";

// The runner reads everything from .env (loaded from the directory you run
// it in: the repo root, via the npm scripts). The Anthropic SDK reads
// ANTHROPIC_API_KEY from the same environment.

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

export type RunnerConfig = ReturnType<typeof readConfig>;

export function readConfig() {
  const missing = ["ANTHROPIC_API_KEY", "CRM_API_KEY", "AGENT_ID", "AGENT_ENVIRONMENT_ID"].filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing in .env: ${missing.join(", ")}.` +
        (missing.some((m) => m.startsWith("AGENT_")) ? " Run `npm run agent:apply` first and copy the IDs it prints." : ""),
    );
  }
  const taskTimeoutMinutes = int("AGENT_TASK_TIMEOUT_MINUTES", 10, 2, 120);
  return {
    crmBaseUrl: (process.env.CRM_BASE_URL || process.env.APP_URL || "http://localhost:3010").replace(/\/+$/, ""),
    crmApiKey: process.env.CRM_API_KEY!,
    agentId: process.env.AGENT_ID!,
    environmentId: process.env.AGENT_ENVIRONMENT_ID!,
    pollSeconds: int("AGENT_POLL_SECONDS", 5, 1, 300),
    reminderCheckMinutes: int("AGENT_REMINDER_CHECK_MINUTES", 5, 1, 1440),
    // How often due invoices are processed (documented range 5 min to 24 h).
    invoicePollSeconds: int("INVOICE_POLL_INTERVAL", 300, 60, 86_400),
    // Hard spend cap per invoice session, in US cents ("200" = $2.00).
    sessionBudgetCents: int("AGENT_SESSION_BUDGET_CENTS", 200, 10, 100_000),
    // One minute under the CRM's own timeout, so the CRM never requeues a
    // task this runner is still working on.
    turnTimeoutMs: (taskTimeoutMinutes - 1) * 60_000,
    consoleWorkspace: process.env.AGENT_CONSOLE_WORKSPACE || "default",
  };
}

export function consoleUrl(cfg: RunnerConfig, sessionId: string): string {
  return `https://platform.claude.com/workspaces/${cfg.consoleWorkspace}/sessions/${sessionId}`;
}
