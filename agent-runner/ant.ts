import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Runs the `ant` CLI with ANTHROPIC_API_KEY taken from .env, so the key
// never has to be exported in your shell:  npm run agent:plan / agent:apply

function antBinary(): string {
  if (process.env.ANT_BIN) return process.env.ANT_BIN;
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "ant", "ant.exe");
  return local && existsSync(local) ? local : "ant";
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set in .env");
  process.exit(1);
}
const result = spawnSync(antBinary(), process.argv.slice(2), { stdio: "inherit", env: process.env });
if (result.error) {
  console.error(`Could not run ant: ${result.error.message}. Install it (see docs/MANAGED_AGENT_PLAN.md).`);
  process.exit(1);
}
process.exit(result.status ?? 1);
