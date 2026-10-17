import Anthropic from "@anthropic-ai/sdk";
import { readConfig } from "./config";
import { CrmClient } from "./crm";

// npm run agent:check - verifies the setup without sending any email or
// starting a session: .env values, the CRM, the agent and environment.

async function main() {
  const cfg = readConfig();
  let ok = true;
  const pass = (msg: string) => console.log(`✔ ${msg}`);
  const fail = (msg: string) => {
    ok = false;
    console.log(`✖ ${msg}`);
  };

  try {
    const r = await new CrmClient(cfg).call<{ count?: number }>("GET", "/api/invoices?limit=1");
    if (r.status === 200) pass(`CRM reachable at ${cfg.crmBaseUrl} and CRM_API_KEY accepted`);
    else fail(`CRM answered ${r.status}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  const client = new Anthropic();
  try {
    const agent = await client.beta.agents.retrieve(cfg.agentId);
    const model = typeof agent.model === "string" ? agent.model : agent.model.id;
    const tools = agent.tools.map((t) => ("name" in t ? t.name : t.type)).join(", ");
    pass(`Agent "${agent.name}" (${agent.id}, version ${agent.version}, model ${model})`);
    console.log(`    tools: ${tools}`);
  } catch (err) {
    fail(`Agent ${cfg.agentId}: ${err instanceof Error ? err.message : err}`);
  }
  try {
    const env = await client.beta.environments.retrieve(cfg.environmentId);
    pass(`Environment "${env.name}" (${env.id})`);
  } catch (err) {
    fail(`Environment ${cfg.environmentId}: ${err instanceof Error ? err.message : err}`);
  }

  const provider = process.env.EMAIL_PROVIDER === "resend" ? "resend" : "outbox";
  if (provider === "resend" && !process.env.RESEND_API_KEY) fail("EMAIL_PROVIDER=resend but RESEND_API_KEY is empty");
  else
    pass(
      provider === "resend"
        ? `Emails go out through Resend${process.env.EMAIL_TEST_RECIPIENT ? `, all redirected to ${process.env.EMAIL_TEST_RECIPIENT}` : ""}`
        : "Emails stay in the CRM outbox (EMAIL_PROVIDER is not resend)",
    );
  console.log(`  Session budget: $${(cfg.sessionBudgetCents / 100).toFixed(2)} per invoice`);

  console.log(ok ? "\nAll good." : "\nFix the items marked ✖ and run again.");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
