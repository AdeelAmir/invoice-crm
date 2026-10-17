import "dotenv/config";
import { randomUUID } from "node:crypto";
import { signPayload } from "@/lib/invoices/webhook";

// Sends a signed payment webhook to the running CRM, the way the payment
// provider would:
//   npm run webhook:test -- <invoiceId> [paid|failed] [baseUrl]

async function main() {
  const [rawId, kind = "paid", baseUrl = "http://localhost:3010"] = process.argv.slice(2);
  const invoiceId = Number(rawId);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0 || !["paid", "failed"].includes(kind)) {
    throw new Error("Usage: npm run webhook:test -- <invoiceId> [paid|failed] [baseUrl]");
  }
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) throw new Error("Set PAYMENT_WEBHOOK_SECRET in .env");

  const body = JSON.stringify({
    id: `evt_test_${randomUUID()}`,
    type: kind === "paid" ? "invoice.paid" : "invoice.payment_failed",
    data: { invoiceId, ...(kind === "failed" ? { reason: "Card declined (test)" } : {}) },
  });
  const res = await fetch(`${baseUrl}/api/webhooks/payment`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-signature": signPayload(body, secret) },
    body,
  });
  console.log(res.status, await res.text());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
