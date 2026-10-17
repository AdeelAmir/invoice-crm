// Invoice-processing settings. Kept apart from the auth secrets so the
// processor, the seed script and the tests can load it on their own.

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function invoiceConfig() {
  return {
    maxRetries: intFromEnv("INVOICE_MAX_RETRIES", 3, 1, 20),
    processingTimeoutMinutes: intFromEnv("INVOICE_PROCESSING_TIMEOUT_MINUTES", 15, 1, 1440),
    retryBaseSeconds: intFromEnv("INVOICE_RETRY_BASE_SECONDS", 60, 1, 86400),
    gatewayLatencyMs: intFromEnv("MOCK_GATEWAY_LATENCY_MS", 800, 0, 10000),
    // Overdue reminders: one every N days after the due date, at most M in all.
    reminderIntervalDays: intFromEnv("INVOICE_REMINDER_INTERVAL_DAYS", 3, 1, 60),
    reminderMax: intFromEnv("INVOICE_REMINDER_MAX", 3, 0, 20),
  };
}

// Agent runner and the emails it sends. The payment link and app URL end
// up in emails, so they must be reachable from the client's browser.
export function agentConfig() {
  const appUrl = (process.env.APP_URL || "http://localhost:3010").replace(/\/+$/, "");
  return {
    appUrl,
    paymentLinkBase: (process.env.PAYMENT_LINK_BASE || `${appUrl}/pay`).replace(/\/+$/, ""),
    businessName: process.env.BUSINESS_NAME || "Ledgerly",
    taskMaxAttempts: intFromEnv("AGENT_TASK_MAX_ATTEMPTS", 3, 1, 10),
    taskTimeoutMinutes: intFromEnv("AGENT_TASK_TIMEOUT_MINUTES", 10, 1, 120),
  };
}

// EMAIL_PROVIDER=resend sends for real; anything else keeps emails in the
// outbox table only. EMAIL_TEST_RECIPIENT redirects every email to one
// inbox (Resend without a verified domain only delivers to the account owner).
export function emailConfig() {
  return {
    provider: process.env.EMAIL_PROVIDER === "resend" ? ("resend" as const) : ("outbox" as const),
    from: process.env.EMAIL_FROM || "Ledgerly Billing <onboarding@resend.dev>",
    testRecipient: process.env.EMAIL_TEST_RECIPIENT?.trim() || null,
    resendApiKey: process.env.RESEND_API_KEY || "",
  };
}
