import { readConfig } from "./config";
import { CrmClient } from "./crm";
import { TaskRunner } from "./runner";

// Testing helper: npm run agent:once
// Processes due invoices, queues due reminders, runs every pending task, then exits.

async function main() {
  const cfg = readConfig();
  const runner = new TaskRunner(cfg, new CrmClient(cfg));
  const processed = await runner.processDueInvoices();
  if (processed.created + processed.failed > 0) {
    console.log(`Invoice schedule: ${processed.created} created, ${processed.failed} failed`);
  }
  const queued = await runner.enqueueReminders();
  if (queued > 0) console.log(`Queued ${queued} overdue reminder(s)`);
  let count = 0;
  while (await runner.runNext()) count++;
  console.log(count === 0 ? "No pending agent tasks." : `\nRan ${count} task(s).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
