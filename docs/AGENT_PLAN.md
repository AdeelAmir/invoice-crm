# Invoice Agent – Complete Plan aur Step-by-Step Guide (Roman Urdu)

> Ye guide pehli dafa agent banane walon ke liye hai. Har step ke saath link aur wajah likhi hai.
> Order mein chalein, aur har phase ke baad us ka "Test" zaroor karein.

---

## 0. Agent karega kya? (Seedhi zubaan mein)

| # | Kaam | Kaise hoga |
|---|------|-----------|
| 1 | Invoice khud banana (one-time ya recurring) | CRM mein PENDING invoice hoti hai → agent har cycle mein `process` call karta hai → CRM gateway par invoice bana kar `CREATED` kar deta hai. Recurring ki agli invoice CRM khud bana deta hai. |
| 2 | Client ko invoice email bhejna | `CREATED` invoices uthata hai → email bhejta hai → CRM ko `SENT` batata hai |
| 3 | Payment na ho to reminder | CRM batata hai kaun si invoice overdue hai → agent reminder "claim" karta hai → email bhejta hai |
| 4 | Payment ho jaye | Payment webhook CRM mein aata hai → invoice `PAID` → reminders khud band |
| 5 | Invoice fail ho to admin ko email | `process` / `retry` ka result `failed` aaye → admin ko alert email |
| 6 | (AI hissa) Admin chat mein bole "Northwind ke liye $500 monthly invoice bana do" | Claude tools ke zariye client dhoondta hai aur CRM mein invoice banata hai |

```
              ┌──────────── har 5 minute (node-cron) ────────────┐
              │                                                   │
   ┌──────────▼──────────┐   x-api-key    ┌───────────────────┐   │
   │   Invoice Agent      │──────────────▶│   Demo CRM (ye)    │   │
   │  (Node + TypeScript) │◀──────────────│  /api/invoices/... │   │
   └───┬──────────┬───────┘                └─────────▲─────────┘   │
       │          │                                  │ signed webhook
       │ email    │ chat / tools                     │ (invoice.paid)
       ▼          ▼                          ┌───────┴────────┐
   ┌────────┐  ┌──────────────┐               │ Payment / Main │
   │ Resend │  │ Claude API   │               │ CRM webhook    │
   └────────┘  └──────────────┘               └────────────────┘
```

**Aham faisla:** Rozana ka kaam (process, email, reminder) **seedha code** karega, AI nahi.
Wajah: paise aur emails mein galti ki gunjaish nahi honi chahiye, aur ye kaam har dafa ek jaisa hai.
Claude sirf wahan use hoga jahan samajh chahiye: admin ki baat samajh kar invoice banana, aur failures ka summary.

---

## 1. CRM mein kya complete kiya gaya (is plan se pehle)

Original CRM brief poora tha (login, Clients, Invoices, Retry, tests). Agent ke liye ye cheezein missing thin, ab add ho gayi hain:

| Cheez | File | Wajah |
|---|---|---|
| `POST /api/invoices` (invoice banana, one-time / recurring) | `app/api/invoices/route.ts`, `lib/invoices/create.ts` | Agent ko invoice banane ka raasta chahiye tha |
| `GET /api/invoices?status=&updatedSince=` | `app/api/invoices/route.ts` | CREATED (bhejni hain) aur FAILED invoices dhoondna |
| `GET /api/invoices/{id}` | `app/api/invoices/[id]/route.ts` | Email ke liye poori detail |
| `POST /api/invoices/{id}/process` aur `/retry` | `app/api/invoices/[id]/process|retry` | Gateway CRM ke andar hai, agent us ko seedha call nahi kar sakta tha |
| `GET /api/invoices/reminders` + `POST /api/invoices/{id}/reminder` | `lib/invoices/reminders.ts` | Overdue reminders; ek reminder do dafa na jaye |
| `POST /api/webhooks/payment` (HMAC signed) | `lib/invoices/webhook.ts` | Payment hone par `PAID`; same event do dafa aaye to ek dafa hi lage |
| `GET /api/clients?search=` | `app/api/clients/route.ts` | Chat agent client ka naam se id dhoonde |
| Naye fields: `sentAt`, `paidAt`, `reminderCount`, `lastReminderAt`, table `webhook_events` | `prisma/schema.prisma` + migration | Tracking |
| Invoice page par Sent / Paid / Reminders | `app/dashboard/invoices/[id]/page.tsx` | Demo mein nazar aaye |
| Seed mein overdue invoice (#15) | `prisma/seed.ts` | Reminder demo ke liye |
| 10 naye integration tests (kul 53, sab pass) | `tests/integration/agent-api.test.ts` | |

**Aap ko CRM mein ye karna hai:**
```bash
npm run db:deploy      # nayi migration (agar pehle se nahi lagi)
npm run db:reset       # OPTIONAL: demo data dobara (overdue invoice wala) – purana data mit jayega
```

---

## 2. Accounts aur Keys (sab se pehle yahi karein)

> **Security ke 3 usool:** (1) Key kabhi git mein commit na karein – sirf `.env` mein. (2) Key WhatsApp / chat / screenshot mein share na karein. (3) Leak ho jaye to fauran delete karke nayi banayein.

### 2.1 Anthropic (Claude) API key – `ANTHROPIC_API_KEY`
1. Jayein: **https://platform.claude.com** (purana link console.anthropic.com bhi yahin le jata hai) → Sign up (Google ya email).
2. **Billing**: https://platform.claude.com/settings/billing → "Buy credits" → shuru mein **$5** kaafi hain (card chahiye).
3. **API key**: https://platform.claude.com/settings/keys → **Create Key** → naam: `invoice-agent-dev`.
4. Key `sk-ant-...` sirf **ek dafa** dikhegi – foran copy karke agent ki `.env` mein daalein.
5. Docs (zaroorat par): https://platform.claude.com/docs

**Kharcha andaza:** Model `claude-opus-5-5` = $4 per 1M input tokens, $20 per 1M output tokens. Ek chat command lagbhag 3–5 hazaar tokens = ~1–3 cent. Rozana ke cycle mein Claude use hi nahi hota, is liye demo ka kharcha bohat kam rahega.

### 2.2 Email bhejne ke liye Resend – `RESEND_API_KEY`
Resend sab se aasaan hai (ek API key, Node package tayyar).
1. Sign up: **https://resend.com/signup**
2. API key: **https://resend.com/api-keys** → Create API Key → permission "Sending access" → copy `re_...`
3. **Testing (domain ke baghair):** `from` mein `onboarding@resend.dev` likhein. Is surat mein email **sirf aap ke apne (signup wale) email** par jayegi. Demo ke liye seed clients ke emails ki jagah apna email use karein (neeche `TEST_EMAIL_OVERRIDE` dekhein).
4. **Asal clients ko bhejne ke liye:** domain verify karein: **https://resend.com/domains** → domain add → jo DNS records (SPF/DKIM) dikhayein woh apne domain provider (GoDaddy / Namecheap / Cloudflare) mein daal dein.
5. Node guide: https://resend.com/docs/send-with-nodejs

> Alternative (agar sir Gmail chahte hain): Gmail SMTP + "App Password" (https://myaccount.google.com/apppasswords, 2-Step Verification on honi chahiye) aur `nodemailer` package. Lekin Gmail ki rozana limit hai aur emails spam mein ja sakti hain – Resend behtar hai.

### 2.3 CRM API key – `CRM_API_KEY`
Pehle se CRM ki `.env` mein hai. **Wahi value** agent ki `.env` mein daalni hai. Nayi banani ho to:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 2.4 Payment webhook secret – `PAYMENT_WEBHOOK_SECRET`
CRM ki `.env` mein add kar diya gaya hai. Ye agent ko **nahi** chahiye – ye us system ko dena hai jo webhook bhejta hai (main CRM / payment provider). Woh har request ki raw body ka HMAC-SHA256 bana kar header `x-webhook-signature: sha256=<hex>` bhejega.

---

## 3. Agent project ka structure

CRM se **alag folder** banayein (taake CRM kharab na ho, aur baad mein client ke asal CRM se jod sakein):

```
C:\xampp\htdocs\invoice-agent\
├─ .env                 # keys (git mein NAHI)
├─ .env.example
├─ package.json
├─ tsconfig.json
└─ src\
   ├─ config.ts         # env parhna + check
   ├─ crm.ts            # CRM API ka chhota client
   ├─ email.ts          # Resend + email templates
   ├─ cycle.ts          # ek cycle: process → send → reminders → alerts
   ├─ scheduler.ts      # har N minute cycle chalana
   ├─ chat.ts           # Claude chat agent (tools)
   └─ run-once.ts       # ek cycle haath se chalana (testing)
```

---

## 4. Phase-by-phase kaam

### Phase 1 – Project setup (30 min)
```bash
cd C:\xampp\htdocs
mkdir invoice-agent && cd invoice-agent
npm init -y
npm install @anthropic-ai/sdk resend zod dotenv node-cron
npm install -D typescript tsx @types/node @types/node-cron
npx tsc --init
```
`package.json` mein:
```json
"type": "module",
"scripts": {
  "once": "tsx src/run-once.ts",
  "start": "tsx src/scheduler.ts",
  "chat": "tsx src/chat.ts"
}
```
`.env`:
```env
CRM_BASE_URL="http://localhost:3010"
CRM_API_KEY="(CRM ki .env wali value)"
ANTHROPIC_API_KEY="sk-ant-..."
RESEND_API_KEY="re_..."
EMAIL_FROM="Invoices <onboarding@resend.dev>"
ADMIN_EMAIL="aapka@email.com"          # failure alerts yahan
TEST_EMAIL_OVERRIDE="aapka@email.com"  # demo: sab client emails yahan jayein. Live par khali chhorein.
CYCLE_CRON="*/5 * * * *"               # har 5 minute
```
`.gitignore` mein `.env` aur `node_modules` likhein.

**Test:** `npx tsx -e "console.log('ok')"` chal jaye.

### Phase 2 – Config aur CRM client (1 ghanta)
`src/config.ts`
```ts
import "dotenv/config";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} .env mein set nahi hai`);
  return v;
}

export const config = {
  crmBaseUrl: need("CRM_BASE_URL"),
  crmApiKey: need("CRM_API_KEY"),
  resendApiKey: need("RESEND_API_KEY"),
  emailFrom: need("EMAIL_FROM"),
  adminEmail: need("ADMIN_EMAIL"),
  testEmailOverride: process.env.TEST_EMAIL_OVERRIDE || null,
  cycleCron: process.env.CYCLE_CRON || "*/5 * * * *",
};
```
`src/crm.ts`
```ts
import { config } from "./config.js";

export type CrmResponse<T = any> = { status: number; data: T };

export async function crm<T = any>(method: string, path: string, body?: unknown): Promise<CrmResponse<T>> {
  const res = await fetch(`${config.crmBaseUrl}${path}`, {
    method,
    headers: { "x-api-key": config.crmApiKey, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status >= 500 || res.status === 401) {
    throw new Error(`CRM ${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return { status: res.status, data };
}

export const logToCrm = (id: number, result: "SUCCESS" | "FAILURE", message: string, step?: string) =>
  crm("POST", `/api/invoices/${id}/log`, { result, message, ...(step ? { step } : {}) });
```
**Test:** CRM chala kar (`npm run dev` CRM folder mein) ek file mein `console.log(await crm("GET", "/api/clients"))` – clients ki list aaye.

### Phase 3 – Email module (1–2 ghante)
`src/email.ts`
```ts
import { Resend } from "resend";
import { config } from "./config.js";

const resend = new Resend(config.resendApiKey);

export async function sendEmail(to: string, subject: string, html: string) {
  const { data, error } = await resend.emails.send({
    from: config.emailFrom,
    to: config.testEmailOverride ?? to,   // demo mein sab aap ke paas
    subject,
    html,
  });
  if (error) throw new Error(`Email fail: ${error.message}`);
  return data?.id;
}

const money = (v: string, cur: string) => `${cur} ${v}`;

export function invoiceEmail(inv: any) {
  const rows = inv.lineItems
    .map((l: any) => `<tr><td>${l.description}</td><td>${l.quantity}</td><td>${money(l.lineTotal, inv.currency)}</td></tr>`)
    .join("");
  return {
    subject: `Invoice ${inv.invoiceNumber} – ${money(inv.total, inv.currency)}`,
    html: `<p>Dear ${inv.client.name},</p>
      <p>Please find your invoice <b>${inv.invoiceNumber}</b>, due on ${inv.dueAt.slice(0, 10)}.</p>
      <table border="1" cellpadding="6">${rows}</table>
      <p>Total: <b>${money(inv.total, inv.currency)}</b></p>`,
  };
}

export function reminderEmail(inv: any, n: number) {
  return {
    subject: `Reminder ${n}: invoice ${inv.invoiceNumber} is overdue`,
    html: `<p>Dear ${inv.client.name},</p>
      <p>Invoice <b>${inv.invoiceNumber}</b> (${money(inv.total, inv.currency)}) was due on ${inv.dueAt.slice(0, 10)}
      and is still unpaid. Please arrange payment at your earliest convenience.</p>`,
  };
}
```
> Note: client ke paas `preferredChannel: "SMS"` bhi hai. Pehle version mein sab ko email jayegi; SMS (Twilio) baad ka kaam hai – sir se poochein.

**Test:** `sendEmail("x@y.com", "Test", "<p>Hello</p>")` – email aap ke inbox mein aaye.

### Phase 4 – Cycle (asal agent ka dil) (3–4 ghante)
`src/cycle.ts`
```ts
import { crm, logToCrm } from "./crm.js";
import { config } from "./config.js";
import { sendEmail, invoiceEmail, reminderEmail } from "./email.js";

const DAY = 86_400_000;

// 1) PENDING ko process, FAILED (backoff guzar chuka) / stuck ko retry
async function processDue() {
  const to = new Date();
  const from = new Date(to.getTime() - 60 * DAY);
  const due = await crm("GET", `/api/invoices/due?from=${from.toISOString()}&to=${to.toISOString()}`);
  for (const inv of due.data.invoices) {
    const action = inv.status === "PENDING" ? "process" : "retry";
    const r = await crm("POST", `/api/invoices/${inv.id}/${action}`);
    if (r.status === 409) continue; // kisi aur ne pehle kar diya – theek hai
    if (r.data.outcome === "failed") {
      const permanent = r.data.errorType === "PERMANENT";
      if (permanent || r.data.retryLimitReached) {
        await alertAdmin(r.data.invoice, r.data.error, permanent ? "data theek karni hogi" : "retry limit khatam");
      }
    }
  }
}

// 2) CREATED invoices client ko bhejo, phir SENT
async function sendCreated() {
  const list = await crm("GET", "/api/invoices?status=CREATED&limit=100");
  for (const row of list.data.invoices) {
    const { data } = await crm("GET", `/api/invoices/${row.id}`);
    const inv = data.invoice;
    try {
      const mail = invoiceEmail(inv);
      const emailId = await sendEmail(inv.client.email, mail.subject, mail.html);
      const r = await crm("PATCH", `/api/invoices/${inv.id}/status`, { status: "SENT" });
      if (r.status !== 200) await logToCrm(inv.id, "FAILURE", `Email gayi (${emailId}) lekin SENT nahi hua: ${r.data.error}`);
    } catch (err) {
      await logToCrm(inv.id, "FAILURE", `Invoice email fail: ${(err as Error).message}`);
      await alertAdmin(inv, (err as Error).message, "invoice email nahi gayi");
    }
  }
}

// 3) Overdue reminders – pehle claim, phir email
async function sendReminders() {
  const list = await crm("GET", "/api/invoices/reminders");
  for (const inv of list.data.invoices) {
    const claim = await crm("POST", `/api/invoices/${inv.id}/reminder`);
    if (claim.status !== 200) continue; // due nahi / kisi aur run ne le liya
    try {
      const mail = reminderEmail(inv, claim.data.reminderNumber);
      await sendEmail(inv.client.email, mail.subject, mail.html);
    } catch (err) {
      await logToCrm(inv.id, "FAILURE", `Reminder email fail: ${(err as Error).message}`, "REMINDER");
    }
  }
}

async function alertAdmin(inv: any, error: string, why: string) {
  await sendEmail(
    config.adminEmail,
    `⚠ Invoice ${inv.invoiceNumber} failed`,
    `<p>Invoice <b>${inv.invoiceNumber}</b> (${inv.client?.name ?? "client " + inv.clientId}) fail hui.</p>
     <p>Error: ${error}</p><p>Wajah: ${why}</p>
     <p><a href="${config.crmBaseUrl}/dashboard/invoices/${inv.id}">CRM mein kholein</a></p>`,
  );
}

export async function runCycle() {
  const started = Date.now();
  await processDue();
  await sendCreated();
  await sendReminders();
  console.log(`[cycle] done in ${Date.now() - started} ms`);
}
```
`src/run-once.ts`
```ts
import { runCycle } from "./cycle.js";
runCycle().catch((e) => { console.error(e); process.exit(1); });
```
**Test (CRM mein seed data ke saath):**
1. `npm run once`
2. CRM dashboard kholein: PENDING invoices → CREATED → SENT; har invoice ke audit log mein entries.
3. "Café Gaspésie" (ghalat email) wali invoice → aap ke ADMIN_EMAIL par alert.
4. Overdue invoice (#15) ka reminder aap ke email par; dobara `npm run once` → dusra reminder **nahi** jana chahiye (3 din ka gap).

### Phase 5 – Scheduler (30 min)
`src/scheduler.ts`
```ts
import cron from "node-cron";
import { config } from "./config.js";
import { runCycle } from "./cycle.js";

let running = false; // ek waqt mein ek hi cycle

cron.schedule(config.cycleCron, async () => {
  if (running) return console.log("[cycle] pichla abhi chal raha hai, skip");
  running = true;
  try { await runCycle(); }
  catch (e) { console.error("[cycle] error", e); }
  finally { running = false; }
});
console.log(`Agent chal raha hai (${config.cycleCron}). Band karne ke liye Ctrl+C`);
```
**Test:** `npm start` → har 5 minute log aaye. Cron expression samajhne ke liye: https://crontab.guru

### Phase 6 – Payment webhook test (15 min)
CRM folder mein (CRM `npm run dev` chal raha ho):
```bash
npm run webhook:test -- <invoiceId> paid
npm run webhook:test -- <invoiceId> failed
```
**Test:** Invoice `PAID` ho jaye, `paidAt` dikhe, aur ab us ka reminder kabhi na jaye. Same event dobara bhejein → `duplicate: true`.
Main CRM wale developer ko README ka "POST /api/webhooks/payment" hissa aur `PAYMENT_WEBHOOK_SECRET` (mehfooz tareeqe se) dein.

### Phase 7 – Claude chat agent (AI hissa) (3–4 ghante)
Admin terminal mein likhe: *"Maple Leaf Dental ke liye 3 ghante consulting $95/hour, Net 15"* → Claude client dhoondta hai, confirm karta hai, invoice banata hai.

`src/chat.ts`
```ts
import "dotenv/config";
import readline from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { crm } from "./crm.js";

const client = new Anthropic(); // ANTHROPIC_API_KEY .env se khud parhta hai

const findClients = betaZodTool({
  name: "find_clients",
  description: "Search active CRM clients by name or email. Use before creating an invoice to get the clientId.",
  inputSchema: z.object({ search: z.string().describe("Part of the client's name or email") }),
  run: async ({ search }) => JSON.stringify((await crm("GET", `/api/clients?search=${encodeURIComponent(search)}`)).data),
});

const createInvoice = betaZodTool({
  name: "create_invoice",
  description:
    "Create a PENDING invoice in the CRM. Tax is added automatically from the client's address. " +
    "Only call this after the admin has confirmed the client, line items, amounts and schedule.",
  inputSchema: z.object({
    clientId: z.number().int(),
    lineItems: z.array(z.object({ description: z.string(), quantity: z.number(), unitPrice: z.number() })).min(1),
    termsDays: z.number().int().optional().describe("Payment terms in days, default 30"),
    recurring: z
      .object({
        frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
        occurrenceCount: z.number().int().optional(),
      })
      .optional()
      .describe("Only for recurring invoices"),
  }),
  run: async (input) => JSON.stringify((await crm("POST", "/api/invoices", input)).data),
});

const listInvoices = betaZodTool({
  name: "list_invoices",
  description: "List invoices, optionally filtered by status (PENDING, CREATED, SENT, PAID, FAILED, CANCELLED).",
  inputSchema: z.object({ status: z.string().optional() }),
  run: async ({ status }) =>
    JSON.stringify((await crm("GET", `/api/invoices?limit=20${status ? `&status=${status}` : ""}`)).data),
});

const retryInvoice = betaZodTool({
  name: "retry_invoice",
  description: "Retry a FAILED invoice (same as the Retry button in the CRM).",
  inputSchema: z.object({ invoiceId: z.number().int() }),
  run: async ({ invoiceId }) => JSON.stringify((await crm("POST", `/api/invoices/${invoiceId}/retry`)).data),
});

const SYSTEM = `You are the invoicing assistant for our CRM admin.
You can find clients, create one-time or recurring invoices, list invoices and retry failed ones.
Before creating an invoice, repeat back the client, line items, amounts, terms and schedule and wait for the admin to say yes.
Never invent prices: if an amount is missing, ask. Amounts are before tax; the CRM adds tax.
The admin may write in Roman Urdu or English; reply in the same language, briefly.`;

const messages: Anthropic.Beta.BetaMessageParam[] = [];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

while (true) {
  const text = await rl.question("\nAdmin> ");
  if (text.trim() === "exit") break;
  messages.push({ role: "user", content: text });

  const final = await client.beta.messages.toolRunner({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM,
    tools: [findClients, createInvoice, listInvoices, retryInvoice],
    messages,
  });

  messages.push({ role: "assistant", content: final.content });
  for (const block of final.content) if (block.type === "text") console.log(`\nAgent> ${block.text}`);
}
rl.close();
```
> Note: tool runner beech ke tool calls ko apne andar sambhalta hai; har turn ke baad hum sirf final jawab history mein daal rahe hain. Demo ke liye ye kaafi hai.

**Test:**
1. `npm run chat`
2. "Northwind ke liye 10 ghante integration kaam, $150 per hour" → agent client dhoonde, summary dikhaye, aap "haan" kahein → CRM mein nayi PENDING invoice.
3. "Har mahine $39.99 hosting, Pacific Coast Yoga, 12 mahine" → RECURRING invoice.
4. "Failed invoices dikhao" → list.
5. Agla `npm run once` → nayi invoices process + email.

### Phase 8 – Demo ke liye final checklist
- [ ] CRM: `npm run db:reset` (fresh demo data) → `npm run dev`
- [ ] Agent `.env` mein `TEST_EMAIL_OVERRIDE` = apna email
- [ ] `npm run once` → invoices SENT, emails inbox mein, Gaspésie ka alert admin ko
- [ ] Retry: Harbourview (timeout) CRM mein Retry → agla cycle us ki email bheje
- [ ] Webhook: `npm run webhook:test -- <id> paid` → PAID, reminder band
- [ ] Chat: ek one-time aur ek recurring invoice banwayein
- [ ] `npm start` chala kar dikhayein ke agent khud har 5 minute kaam karta hai

### Phase 9 – Baad mein (production / client ka asal CRM)
- `CRM_BASE_URL` client ke asal CRM ka; agar un ke APIs ke naam alag hain to sirf `src/crm.ts` badalna hoga.
- Hosting: agent ek chhoti VPS ya Railway / Render par 24/7 (`npm start`); ya Windows par PM2 (https://pm2.keymetrics.io).
- Resend par domain verify; `TEST_EMAIL_OVERRIDE` khali.
- SMS clients ke liye Twilio (agar sir chahein).
- Keys rotate karein aur har environment (dev / live) ki alag key.

---

## 5. Hifazati intezamat (safeguards) – kyun aur kaise

| Khatra | Bachao |
|---|---|
| Ek invoice gateway par 2 dafa bane | CRM claim atomic hai + gateway idempotency key `crm-invoice-<id>` |
| Ek reminder 2 dafa jaye | `POST /reminder` guarded claim: ek hi run ko 200 milta hai, baqi ko 409 |
| Do agent cycles ek saath | Scheduler mein `running` flag; aur sirf **ek** agent instance chalayein |
| Webhook dobara aaye | `webhook_events.eventId` unique → `duplicate: true`, kuch nahi badalta |
| Jaali webhook | HMAC signature check; ghalat ho to 401 |
| Email chali gayi lekin SENT update fail | Audit log mein FAILURE entry; admin dashboard par nazar aata hai |
| Claude ghalat amount daal de | System prompt: amount na ho to poochho, banane se pehle confirm karwao; tax CRM khud lagata hai |
| Key leak | `.env` git mein nahi; leak par key delete + nayi |

Abhi ki ek kamzori (demo ke liye qabool): agar invoice email chali jaye aur usi waqt agent crash ho jaye (SENT se pehle), to agle cycle mein email dobara ja sakti hai. Production mein is ke liye CRM mein "send claim" step add karenge (reminder jaisa).

---

## 6. Sir se poochne wale sawal (missing information)

1. Emails kis domain / address se jayengi? (Resend domain verification ke liye DNS access chahiye)
2. Reminder schedule: abhi due date ke baad har 3 din, zyada se zyada 3 reminders. Kya due date se **pehle** bhi reminder chahiye?
3. Admin alert kis email (ya emails) par jaye?
4. SMS clients (`preferredChannel: SMS`) ko SMS chahiye ya email kaafi hai?
5. Main CRM ka payment webhook kis format mein aata hai? (Humara format README mein hai; agar un ka alag hai to webhook route ko us ke mutabiq banayenge.)
6. Invoice email mein PDF attachment ya "Pay now" link chahiye? (Asal payment gateway aane par.)

---

## 7. Waqt ka andaza

| Phase | Waqt |
|---|---|
| Keys + accounts | 1 ghanta |
| Phase 1–3 (setup, CRM client, email) | 3 ghante |
| Phase 4–5 (cycle + scheduler) | 4 ghante |
| Phase 6 (webhook test) | 15 min |
| Phase 7 (Claude chat agent) | 3–4 ghante |
| Testing + demo tayyari | 2 ghante |
| **Kul** | **~2 din** |
