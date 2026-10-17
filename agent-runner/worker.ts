import { readConfig } from "./config";
import { CrmClient } from "./crm";
import { TaskRunner } from "./runner";

// Long-running worker: npm run agent:worker (Ctrl+C to stop).
// Runs the invoicing schedule (INVOICE_POLL_INTERVAL), queues overdue
// reminders, and works through the agent task queue.

const cfg = readConfig();
const runner = new TaskRunner(cfg, new CrmClient(cfg));
let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log("\nStopping after the current task (Ctrl+C again to force)...");
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Invoice agent worker: CRM ${cfg.crmBaseUrl}, agent ${cfg.agentId}, polling every ${cfg.pollSeconds}s`);
  let lastReminderCheck = 0;
  let lastInvoiceRun = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastInvoiceRun >= cfg.invoicePollSeconds * 1000) {
        const r = await runner.processDueInvoices();
        if (r.created + r.failed > 0) console.log(`Invoice schedule: ${r.created} created, ${r.failed} failed`);
        lastInvoiceRun = Date.now();
      }
      if (Date.now() - lastReminderCheck >= cfg.reminderCheckMinutes * 60_000) {
        const queued = await runner.enqueueReminders();
        if (queued > 0) console.log(`Queued ${queued} overdue reminder(s)`);
        lastReminderCheck = Date.now();
      }
      const didWork = await runner.runNext();
      if (!didWork) await sleep(cfg.pollSeconds * 1000);
    } catch (err) {
      console.error(`Worker error: ${err instanceof Error ? err.message : err}`);
      await sleep(cfg.pollSeconds * 1000);
    }
  }
}

main().then(() => process.exit(0));
