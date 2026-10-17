import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ quiet: true });

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // "server-only" throws outside the React server build; tests are server code.
      "server-only": fileURLToPath(new URL("./tests/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          env: {
            SESSION_SECRET: "unit-test-secret-unit-test-secret-1234",
            // Never send real email from tests.
            EMAIL_PROVIDER: "outbox",
            EMAIL_TEST_RECIPIENT: "",
          },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
          env: {
            // Never the app database: global-setup wipes this one.
            DATABASE_URL: process.env.DATABASE_URL_TEST ?? "",
            MOCK_GATEWAY_LATENCY_MS: "0",
            INVOICE_MAX_RETRIES: "3",
            INVOICE_PROCESSING_TIMEOUT_MINUTES: "15",
            CRM_API_KEY: "integration-test-api-key-123456",
            PAYMENT_WEBHOOK_SECRET: "integration-test-webhook-secret-123456",
            INVOICE_REMINDER_INTERVAL_DAYS: "3",
            INVOICE_REMINDER_MAX: "3",
            // Never send real email from tests: the outbox table only.
            EMAIL_PROVIDER: "outbox",
            EMAIL_TEST_RECIPIENT: "",
            ADMIN_ALERT_EMAIL: "admin-alerts@test.local",
            PAYMENT_LINK_BASE: "http://localhost:3010/pay",
            APP_URL: "http://localhost:3010",
            AGENT_TASK_MAX_ATTEMPTS: "3",
          },
        },
      },
    ],
  },
});
