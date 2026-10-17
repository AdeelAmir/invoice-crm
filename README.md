# Invoice Automation – Demo CRM

Demo CRM for the invoicing-automation workflow: an admin panel with **Client Management** and **Invoices** (status, manual status changes, **Retry** and **Generate now**), the CRM API the automation will call, and a mock payment gateway. Built for demonstration; the client's own system replaces it later.

Stack: Next.js 16 (App Router), PostgreSQL 17, Prisma 7 (`@prisma/adapter-pg`), Tailwind 4, shadcn/ui components, zod, jose + bcryptjs.

## Setup

```bash
npm install                 # also runs prisma generate
cp .env.example .env        # fill in DATABASE_URL, SESSION_SECRET, ADMIN_*, CRM_API_KEY
npm run db:deploy           # apply migrations (or db:migrate while developing)
npm run db:seed             # admin account (sample data: npm run db:seed:sample on an empty DB)
npm run dev                 # http://localhost:3010
```

Database user (once, as `postgres`):

```sql
CREATE ROLE invoice_demo_user LOGIN PASSWORD '...' CREATEDB;  -- CREATEDB: prisma migrate dev's shadow DB
CREATE DATABASE invoice_demo OWNER invoice_demo_user;
CREATE DATABASE invoice_demo_test OWNER invoice_demo_user;    -- integration tests (wiped on every run)
```

`npm run db:reset` drops all data and re-seeds. `npm run db:studio` opens Prisma Studio to browse the tables.

## Processing flow

`lib/invoices/processor.ts` implements the documented steps for one invoice:

1. **Claim**: `PENDING → PROCESSING` in a single guarded update; a second caller gets nothing.
2. **Gateway create**: mock gateway, idempotency key `crm-invoice-<id>`, so a retry after a crash returns the same gateway invoice.
3. **Mark CREATED** with the gateway invoice id. The write is guarded on the claim time, so a stale run cannot overwrite a newer one.
4. Sending to the client is **out of scope** for the demo.
5. **Audit log** entry for every step (`audit_logs`, append-only).

Recurring invoices: once an occurrence is CREATED, the next one is generated from its rule (weekly / monthly / quarterly / yearly, in the client's timezone; at most one successor per occurrence).

Failures: data problems (invalid email, deactivated client, no line items) are **permanent**; gateway timeouts and unexpected errors are **retryable** and get `nextRetryAt` with exponential backoff. Retries stop at `INVOICE_MAX_RETRIES`.

Admin actions: **Retry** (failed under the limit, or stuck in PROCESSING longer than `INVOICE_PROCESSING_TIMEOUT_MINUTES`), **Generate now** (pending), **Mark as paid** / **Cancel** (see `lib/invoices/transitions.ts`).

Tax (`lib/tax.ts`): QC GST 5% + QST 9.975%; HST in ON 13%, NS 14%, NB/NL/PE 15%; GST 5% elsewhere in Canada; none outside Canada.

## CRM API

All routes need `x-api-key: <CRM_API_KEY>` (or `Authorization: Bearer <key>`). Dates are UTC ISO-8601; money is a 2-decimal string.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/invoices/due?from=&to=&status=` | Invoices whose issue time is in the window. Default statuses `PENDING,FAILED,PROCESSING`: FAILED returns only retryable ones under the limit whose backoff has passed; PROCESSING returns only stuck ones. |
| POST | `/api/invoices/{id}/claim` | Atomic `PENDING → PROCESSING`. 200 when claimed, 409 when not pending. |
| PATCH | `/api/invoices/{id}/status` | Body `{ status, gatewayInvoiceId?, error?, errorType? }`. Only allowed transitions; 409 otherwise. |
| POST | `/api/invoices/{id}/log` | Body `{ result: "SUCCESS"\|"FAILURE", message, step?, metadata? }`. 201. |
| GET | `/api/invoices?status=&clientId=&updatedSince=&limit=` | Invoices, newest change first (e.g. new failures since the agent's last run). |
| POST | `/api/invoices` | Body `{ clientId, lineItems: [{ description, quantity, unitPrice }], issueAt?, termsDays?, recurring?: { frequency, occurrenceCount?, endDate? } }`. Adds a PENDING invoice; tax from the client's province. 201. |
| GET | `/api/invoices/{id}` | One invoice with client, line items and taxes. |
| POST | `/api/invoices/{id}/process` | Full flow on a PENDING invoice (claim → gateway → CREATED → next recurring). 200 with `outcome` `created`/`failed`; 409 when it did not run. |
| POST | `/api/invoices/{id}/retry` | Same as the Retry button. 200 / 409 as above. |
| GET | `/api/invoices/reminders` | SENT invoices past due and due for a reminder now. |
| POST | `/api/invoices/{id}/reminder` | Claim the next reminder before sending: 200 → send it; 409 → none due or already claimed. |
| GET | `/api/clients?search=&includeInactive=` | Find clients by name or email. |
| POST | `/api/webhooks/payment` | Payment provider webhook, **no API key**: signed with `x-webhook-signature: sha256=<HMAC-SHA256(raw body, PAYMENT_WEBHOOK_SECRET)>`. Body `{ id, type: "invoice.paid"\|"invoice.payment_failed", data: { invoiceId? \| gatewayInvoiceId?, reason? } }`. Paid → `PAID`; repeated event ids are ignored. |

Overdue reminders: one every `INVOICE_REMINDER_INTERVAL_DAYS` after the due date, at most `INVOICE_REMINDER_MAX`; a paid invoice drops out automatically. Try the webhook against the running app with `npm run webhook:test -- <invoiceId> [paid|failed]`.

```bash
curl -H "x-api-key: $CRM_API_KEY" \
  "http://localhost:3010/api/invoices/due?from=2026-10-01T00:00:00Z&to=2026-10-31T23:59:59Z"
```

## Invoice agent (Claude Managed Agent)

The agent writes the invoice, receipt and reminder emails, answers client replies and escalates disputes and refund requests to the admin. Money stays in the CRM: the agent has no tool that changes an amount or a status, every email goes to the client's address on file, and the CRM appends the official totals and payment link itself.

| Piece | Where |
|---|---|
| Agent definition (model, 6 custom tools, system prompt) | `agents/invoice-agent.md` |
| Sandbox environment | `environments/invoice-agent.yaml` |
| IDs of both in the Console | `claude-lock.json` (commit it) |
| Agent runner (bridges the agent and the CRM; reads keys from `.env`) | `agent-runner/` |
| Task queue, email rules, escalation, alerts | `lib/agent/`, `lib/email/outbox.ts` |
| Runner API (`x-api-key`) | `app/api/agent/...` |
| Mock payment page | `app/pay/[id]` |

Billing starts on the client form: each client has a **billing plan** (one-time on a date, or monthly from a date, with service, amount and payment terms). Saving the client schedules the invoice: a date of today is created at once, a later date is created by the worker on that day, and a monthly plan creates the next invoice on the same day every month. Editing the plan stops the old schedule and starts the new one (`lib/invoices/plans.ts`); it refuses a date the old plan already billed, so a client is never billed twice. Invoices are never added by hand: they come only from client billing plans.

Flow: invoice CREATED, mock payment, client message or overdue reminder → the CRM queues an `agent_tasks` row → the worker claims it and runs it in that invoice's Managed Agent session (one session per invoice) → the agent's tool calls come back to the runner, which calls the CRM. Failure alerts are sent by code, without the agent. The worker also runs the invoicing schedule (`INVOICE_POLL_INTERVAL`).

```bash
npm run agent:plan      # dry run: what ant apply would create or change
npm run agent:apply     # create/update the agent + environment in the Console (needs the ant CLI)
npm run agent:check     # verify .env, CRM, agent and environment (sends nothing)
npm run agent:worker    # run the agent continuously (Ctrl+C to stop)
npm run agent:once      # process due invoices + run pending tasks once, then exit
```

Emails: always stored in `email_messages` (shown on the invoice page); with `EMAIL_PROVIDER=resend` also sent through Resend, redirected to `EMAIL_TEST_RECIPIENT` when set. Step-by-step manual testing (Roman Urdu, with test data): `docs/Ledgerly-Testing-Guide.pdf`.

## Tests

```bash
npm run test:unit           # tax, money, DST-safe recurrence, transitions, validation, auth
npm run test:integration    # against DATABASE_URL_TEST: duplicate runs, crash recovery, retries, limits, recurring, API
npm test                    # both
npm run typecheck && npm run lint
```

## Not in this demo (next phase)

Real payment gateway (payments are mocked at `/pay/{id}`), inbound email (client replies are simulated from the invoice page), SMS, and an admin daily summary.
