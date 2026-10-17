import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-key";
import { badRequest, serializeInvoice } from "@/lib/api";
import { dueInvoices } from "@/lib/invoices/service";
import { InvoiceStatus } from "@/lib/generated/prisma/enums";

// GET /api/invoices/due?from=<ISO UTC>&to=<ISO UTC>&status=PENDING,FAILED,PROCESSING
const querySchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  status: z
    .string()
    .default("PENDING,FAILED,PROCESSING")
    .transform((s) => s.split(",").map((x) => x.trim().toUpperCase()))
    .pipe(z.array(z.enum(Object.values(InvoiceStatus) as [InvoiceStatus, ...InvoiceStatus[]])).min(1)),
});

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return badRequest("from and to must be ISO-8601 date-times; status a comma list of statuses", z.flattenError(parsed.error).fieldErrors);
  }
  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  if (from > to) return badRequest("from must not be after to");

  const invoices = await dueInvoices({ from, to, statuses: parsed.data.status });
  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    statuses: parsed.data.status,
    count: invoices.length,
    invoices: invoices.map(serializeInvoice),
  });
}
