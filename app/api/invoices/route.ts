import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-key";
import { badRequest, serializeInvoice } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createInvoice } from "@/lib/invoices/create";
import { newInvoiceSchema } from "@/lib/validation/invoice";
import { InvoiceStatus } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";

// GET /api/invoices?status=FAILED,SENT&clientId=&updatedSince=<ISO UTC>&limit=50
// Newest change first. updatedSince lets the agent ask "what changed since
// my last run" (e.g. new failures to report).
const querySchema = z.object({
  status: z
    .string()
    .transform((s) => s.split(",").map((x) => x.trim().toUpperCase()))
    .pipe(z.array(z.enum(Object.values(InvoiceStatus) as [InvoiceStatus, ...InvoiceStatus[]])).min(1))
    .optional(),
  clientId: z.coerce.number().int().positive().optional(),
  updatedSince: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return badRequest("Invalid query", z.flattenError(parsed.error).fieldErrors);
  const { status, clientId, updatedSince, limit } = parsed.data;

  const where: Prisma.InvoiceWhereInput = {
    ...(status ? { status: { in: status } } : {}),
    ...(clientId ? { clientId } : {}),
    ...(updatedSince ? { updatedAt: { gt: new Date(updatedSince) } } : {}),
  };
  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    include: { client: true },
  });
  return NextResponse.json({ count: invoices.length, invoices: invoices.map(serializeInvoice) });
}

// POST /api/invoices
// body: { clientId, lineItems: [{ description, quantity, unitPrice }], issueAt?, termsDays?,
//         recurring?: { frequency, occurrenceCount?, endDate? } }
// Adds a PENDING invoice; tax and totals come from the client's address.
export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = newInvoiceSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid body", z.flattenError(parsed.error).fieldErrors);
  const { clientId, lineItems, issueAt, termsDays, recurring } = parsed.data;

  const result = await createInvoice(
    {
      clientId,
      lineItems,
      issueAt: issueAt ? new Date(issueAt) : new Date(),
      termsDays,
      recurring: recurring && {
        frequency: recurring.frequency,
        occurrenceCount: recurring.occurrenceCount ?? null,
        endDate: recurring.endDate ? new Date(recurring.endDate) : null,
      },
    },
    "api",
  );
  if (!result.ok) {
    const status = result.error === "Client not found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  revalidatePath("/dashboard/invoices", "layout");
  revalidatePath("/dashboard/clients", "layout");

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: result.invoice.id },
    include: { client: true, lineItems: true, taxes: true },
  });
  return NextResponse.json({ invoice: serializeInvoice(invoice) }, { status: 201 });
}
