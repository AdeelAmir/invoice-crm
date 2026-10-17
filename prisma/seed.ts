import "dotenv/config";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { claimInvoice, processInvoice } from "@/lib/invoices/processor";
import { createInvoice as addInvoice } from "@/lib/invoices/create";
import { retryInvoice, systemSetStatus, adminSetStatus } from "@/lib/invoices/service";
import type { Client } from "@/lib/generated/prisma/client";
import type { RecurrenceFrequency, SimulatedFailure } from "@/lib/generated/prisma/enums";

// Seeds the demo admin (always, from ADMIN_* env vars) and, on an empty
// database, demo clients and invoices. Invoices are pushed through the
// real processing flow, so every status and audit entry is genuine.

const ACTOR = "seed";
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Admin";
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
  if (password.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  const passwordHash = await hashPassword(password);
  await prisma.admin.upsert({
    where: { email },
    update: { name, passwordHash },
    create: { email, name, passwordHash },
  });
  console.log(`✔ Admin ready: ${email}`);
}

type ClientSeed = Omit<
  Client,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "smsConsentAt"
  | "addressLine2"
  | "billingType"
  | "billingDescription"
  | "billingAmount"
  | "billingDate"
  | "billingTermsDays"
> & {
  addressLine2?: string | null;
};

const CLIENTS: Record<string, ClientSeed> = {
  boulangerie: {
    name: "Boulangerie Saint-Laurent",
    email: "comptes@boulangerie-stlaurent.ca",
    phone: "+15145550142",
    addressLine1: "4521 boulevard Saint-Laurent",
    city: "Montréal",
    province: "QC",
    postalCode: "H2T 1R2",
    country: "CA",
    timezone: "America/Toronto",
    preferredChannel: "EMAIL",
    smsConsent: false,
    isActive: true,
  },
  lavoie: {
    name: "Lavoie & Fils Construction",
    email: "facturation@lavoiefils.ca",
    phone: "+14185550187",
    addressLine1: "880 rue Saint-Joseph Est",
    city: "Québec",
    province: "QC",
    postalCode: "G1K 3C8",
    country: "CA",
    timezone: "America/Toronto",
    preferredChannel: "SMS",
    smsConsent: true,
    isActive: true,
  },
  dental: {
    name: "Maple Leaf Dental",
    email: "billing@mapleleafdental.ca",
    phone: "+14165550110",
    addressLine1: "200 King Street West",
    addressLine2: "Suite 1200",
    city: "Toronto",
    province: "ON",
    postalCode: "M5H 3T4",
    country: "CA",
    timezone: "America/Toronto",
    preferredChannel: "EMAIL",
    smsConsent: true,
    isActive: true,
  },
  yoga: {
    name: "Pacific Coast Yoga",
    email: "accounts@pacificcoastyoga.ca",
    phone: "+16045550133",
    addressLine1: "1055 West Georgia Street",
    city: "Vancouver",
    province: "BC",
    postalCode: "V6E 3P3",
    country: "CA",
    timezone: "America/Vancouver",
    preferredChannel: "EMAIL",
    smsConsent: false,
    isActive: true,
  },
  marine: {
    name: "Harbourview Marine Supply",
    email: "ap@harbourviewmarine.ca",
    phone: "+19025550199",
    addressLine1: "1801 Lower Water Street",
    city: "Halifax",
    province: "NS",
    postalCode: "B3J 1S5",
    country: "CA",
    timezone: "America/Halifax",
    preferredChannel: "EMAIL",
    smsConsent: false,
    isActive: true,
  },
  outfitters: {
    name: "Rocky Ridge Outfitters",
    email: "finance@rockyridge.ca",
    phone: "+14035550166",
    addressLine1: "315 8 Avenue SW",
    city: "Calgary",
    province: "AB",
    postalCode: "T2P 1C4",
    country: "CA",
    timezone: "America/Edmonton",
    preferredChannel: "SMS",
    smsConsent: true,
    isActive: true,
  },
  northwind: {
    name: "Northwind Trading LLC",
    email: "payables@northwind-trading.com",
    phone: "+12125550175",
    addressLine1: "350 Fifth Avenue",
    city: "New York",
    province: "NY",
    postalCode: "10118",
    country: "US",
    timezone: "America/New_York",
    preferredChannel: "EMAIL",
    smsConsent: false,
    isActive: true,
  },
  // Deliberately broken email: shows a permanent failure fixed by editing.
  gaspesie: {
    name: "Café Gaspésie",
    email: "factures@cafe-gaspesie",
    phone: "+14185550123",
    addressLine1: "12 rue de la Reine",
    city: "Gaspé",
    province: "QC",
    postalCode: "G4X 1T1",
    country: "CA",
    timezone: "America/Toronto",
    preferredChannel: "EMAIL",
    smsConsent: false,
    isActive: true,
  },
  studios: {
    name: "Old Port Studios",
    email: "admin@oldportstudios.ca",
    phone: "+15145550190",
    addressLine1: "333 rue de la Commune Ouest",
    city: "Montréal",
    province: "QC",
    postalCode: "H2Y 2E2",
    country: "CA",
    timezone: "America/Toronto",
    preferredChannel: "EMAIL",
    smsConsent: false,
    isActive: true, // deactivated after its invoice is paid
  },
};

type Line = { description: string; quantity: number; unitPrice: number };

async function createInvoice(
  client: Client,
  lines: Line[],
  opts: {
    issueAt: Date;
    termsDays?: number;
    simulateFailure?: SimulatedFailure;
    recurring?: { frequency: RecurrenceFrequency; occurrenceCount?: number };
  },
) {
  const r = await addInvoice(
    {
      clientId: client.id,
      lineItems: lines,
      issueAt: opts.issueAt,
      termsDays: opts.termsDays ?? 30,
      recurring: opts.recurring,
      simulateFailure: opts.simulateFailure,
    },
    ACTOR,
  );
  if (!r.ok) throw new Error(`Seed could not create an invoice for ${client.name}: ${r.error}`);
  return r.invoice;
}

async function mustCreate(invoiceId: number) {
  const r = await processInvoice(invoiceId, ACTOR);
  if (r.outcome !== "created") throw new Error(`Seed expected invoice ${invoiceId} to be created: ${JSON.stringify(r)}`);
  return r;
}

async function markSent(invoiceId: number) {
  await systemSetStatus(invoiceId, { status: "SENT" }, ACTOR);
}

async function markPaid(invoiceId: number) {
  await systemSetStatus(invoiceId, { status: "PAID" }, ACTOR);
}

async function seedDemoData() {
  const now = Date.now();
  const c: Record<string, Client> = {};
  for (const [key, data] of Object.entries(CLIENTS)) {
    c[key] = await prisma.client.create({
      data: { ...data, smsConsentAt: data.smsConsent ? new Date(now - 60 * DAY) : null },
    });
  }

  // 1. Paid one-time invoice (Quebec: GST + QST).
  const paid = await createInvoice(
    c.boulangerie,
    [
      { description: "Website maintenance, September", quantity: 1, unitPrice: 450 },
      { description: "Online ordering module, setup", quantity: 1, unitPrice: 1200 },
    ],
    { issueAt: new Date(now - 20 * DAY) },
  );
  await mustCreate(paid.id);
  await markSent(paid.id);
  await markPaid(paid.id);

  // 2. Monthly recurring (Quebec, SMS client): two occurrences processed, the
  //    third generated as PENDING for next month.
  const monthly = await createInvoice(
    c.lavoie,
    [{ description: "Fleet tracking subscription, 12 vehicles", quantity: 12, unitPrice: 39.99 }],
    { issueAt: new Date(now - 40 * DAY), recurring: { frequency: "MONTHLY", occurrenceCount: 12 } },
  );
  const m1 = await mustCreate(monthly.id);
  await markSent(monthly.id);
  await markPaid(monthly.id);
  const m2 = await mustCreate(m1.nextInvoiceId!);
  await markSent(m1.nextInvoiceId!);
  void m2;

  // 3. Sent, awaiting payment (Ontario HST).
  const sent = await createInvoice(
    c.dental,
    [
      { description: "Patient booking system, annual licence", quantity: 1, unitPrice: 2400 },
      { description: "Staff training session (hours)", quantity: 3, unitPrice: 95 },
    ],
    { issueAt: new Date(now - 5 * DAY) },
  );
  await mustCreate(sent.id);
  await markSent(sent.id);

  // 4. Created in the gateway, not yet sent (BC: GST only).
  const created = await createInvoice(
    c.yoga,
    [{ description: "Class scheduling app, quarterly plan", quantity: 1, unitPrice: 597 }],
    { issueAt: new Date(now - 2 * DAY), termsDays: 15 },
  );
  await mustCreate(created.id);

  // 5. Failed with a temporary gateway timeout: Retry succeeds.
  const timeout = await createInvoice(
    c.marine,
    [{ description: "Inventory management, October", quantity: 1, unitPrice: 780 }],
    { issueAt: new Date(now - 1 * DAY), simulateFailure: "TIMEOUT" },
  );
  await processInvoice(timeout.id, ACTOR);

  // 6. Failed permanently: invalid client email. Fix the email, then Retry.
  const badEmail = await createInvoice(
    c.gaspesie,
    [{ description: "Point-of-sale terminal rental", quantity: 2, unitPrice: 65 }],
    { issueAt: new Date(now - 3 * DAY) },
  );
  await processInvoice(badEmail.id, ACTOR);

  // 7. Failed and out of retries (limit reached): can only be cancelled.
  const exhausted = await createInvoice(
    c.gaspesie,
    [{ description: "Menu board design", quantity: 1, unitPrice: 350 }],
    { issueAt: new Date(now - 10 * DAY) },
  );
  await processInvoice(exhausted.id, ACTOR);
  for (let i = 0; i < 5; i++) {
    const r = await retryInvoice(exhausted.id, ACTOR);
    if (r.outcome === "skipped") break;
  }

  // 8. Pending and due now (USD, no Canadian tax): Generate now.
  const usd = await createInvoice(
    c.northwind,
    [{ description: "Cross-border logistics integration", quantity: 10, unitPrice: 150 }],
    { issueAt: new Date(now - 1 * HOUR) },
  );
  void usd;

  // 9. Pending, will time out on the first try: Generate now fails, Retry works.
  const flaky = await createInvoice(
    c.outfitters,
    [{ description: "E-commerce hosting, monthly", quantity: 1, unitPrice: 249 }],
    { issueAt: new Date(now - 2 * HOUR), simulateFailure: "TIMEOUT" },
  );
  void flaky;

  // 10. Pending, scheduled in a few days.
  await createInvoice(
    c.boulangerie,
    [{ description: "Website maintenance, October", quantity: 1, unitPrice: 450 }],
    { issueAt: new Date(now + 3 * DAY) },
  );

  // 11. Cancelled by an admin after creation.
  const cancelled = await createInvoice(
    c.dental,
    [{ description: "Duplicate order, cancelled", quantity: 1, unitPrice: 120 }],
    { issueAt: new Date(now - 6 * DAY) },
  );
  await mustCreate(cancelled.id);
  await adminSetStatus(cancelled.id, "CANCELLED", ACTOR);

  // 12. Weekly recurring: first processed, the next one pending.
  const weekly = await createInvoice(
    c.boulangerie,
    [{ description: "Social media posts, weekly package", quantity: 1, unitPrice: 180 }],
    { issueAt: new Date(now - 8 * DAY), termsDays: 7, recurring: { frequency: "WEEKLY", occurrenceCount: 4 } },
  );
  await mustCreate(weekly.id);

  // 13. Stuck in PROCESSING (a run crashed after the claim): Retry recovers it.
  const stuck = await createInvoice(
    c.marine,
    [{ description: "Barcode scanners (units)", quantity: 4, unitPrice: 210 }],
    { issueAt: new Date(now - 4 * DAY) },
  );
  await claimInvoice(stuck.id, ACTOR);
  await prisma.invoice.update({
    where: { id: stuck.id },
    data: { processingStartedAt: new Date(now - 2 * HOUR) },
  });

  // 14. Paid history for a client that was then deactivated.
  const studio = await createInvoice(
    c.studios,
    [{ description: "Photo archive hosting, annual", quantity: 1, unitPrice: 900 }],
    { issueAt: new Date(now - 90 * DAY) },
  );
  await mustCreate(studio.id);
  await markSent(studio.id);
  await markPaid(studio.id);
  await prisma.client.update({ where: { id: c.studios.id }, data: { isActive: false } });

  // 15. Sent and overdue, never reminded: the agent's first overdue reminder.
  const overdue = await createInvoice(
    c.outfitters,
    [{ description: "Store migration project, phase 1", quantity: 1, unitPrice: 1850 }],
    { issueAt: new Date(now - 35 * DAY), termsDays: 30 },
  );
  await mustCreate(overdue.id);
  await markSent(overdue.id);

  // The seeded history is already emailed and paid: drop the agent tasks it
  // queued, keeping only the invoice email for invoices still CREATED.
  await prisma.agentTask.deleteMany({
    where: { NOT: { type: "INVOICE_EMAIL", invoice: { status: "CREATED" } } },
  });

  const counts = await prisma.invoice.groupBy({ by: ["status"], _count: { _all: true } });
  console.log(`✔ ${Object.keys(c).length} clients`);
  console.log(
    `✔ invoices: ${counts.map((x) => `${x.status.toLowerCase()} ${x._count._all}`).join(", ")}`,
  );
}

async function main() {
  // The mock gateway pauses to look realistic in the UI; not while seeding.
  process.env.MOCK_GATEWAY_LATENCY_MS = "0";
  await seedAdmin();
  // A clean install gets the admin only. Sample clients and invoices are
  // opt-in: SEED_SAMPLE_DATA=true npm run db:seed (or npm run db:seed:sample).
  if (process.env.SEED_SAMPLE_DATA !== "true") {
    console.log("✔ No sample data (set SEED_SAMPLE_DATA=true to add sample clients and invoices)");
    return;
  }
  const existing = await prisma.client.count();
  if (existing > 0) {
    console.log(`Clients already present (${existing}); sample data skipped. Run "npm run db:reset" first.`);
    return;
  }
  await seedDemoData();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
