import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-key";
import { notFoundJson, parseInvoiceId, serializeInvoice } from "@/lib/api";
import { prisma } from "@/lib/db";

// GET /api/invoices/{id}: the invoice with client, line items and taxes
// (what the agent needs to write the email).
export async function GET(request: Request, ctx: RouteContext<"/api/invoices/[id]">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return notFoundJson();

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { client: true, lineItems: { orderBy: { position: "asc" } }, taxes: true },
  });
  if (!invoice) return notFoundJson();
  return NextResponse.json({ invoice: serializeInvoice(invoice) });
}
