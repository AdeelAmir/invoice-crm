import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireApiKey } from "@/lib/api-key";
import { notFoundJson, parseInvoiceId, serializeInvoice } from "@/lib/api";
import { prisma } from "@/lib/db";
import { apiClaim } from "@/lib/invoices/service";

// POST /api/invoices/{id}/claim: atomically PENDING -> PROCESSING.
// 200 when this caller now owns the invoice, 409 when it was already claimed.
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/claim">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return notFoundJson();

  const result = await apiClaim(id, "api");
  if (!result.found) return notFoundJson();
  revalidatePath("/dashboard/invoices", "layout");

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id },
    include: { client: true, lineItems: true, taxes: true },
  });
  if (!result.claimed) {
    return NextResponse.json(
      { error: "Invoice is not PENDING (already claimed or processed)", invoice: serializeInvoice(invoice) },
      { status: 409 },
    );
  }
  return NextResponse.json({ claimed: true, invoice: serializeInvoice(invoice) });
}
