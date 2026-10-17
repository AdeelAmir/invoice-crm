import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-key";
import { badRequest, notFoundJson, parseInvoiceId, serializeInvoice } from "@/lib/api";
import { prisma } from "@/lib/db";
import { systemSetStatus } from "@/lib/invoices/service";
import { ErrorType, InvoiceStatus } from "@/lib/generated/prisma/enums";

// PATCH /api/invoices/{id}/status
// body: { status, gatewayInvoiceId?, error?, errorType? }
const bodySchema = z.object({
  status: z.enum(Object.values(InvoiceStatus) as [InvoiceStatus, ...InvoiceStatus[]]),
  gatewayInvoiceId: z.string().trim().min(1).max(100).optional(),
  error: z.string().trim().min(1).max(1000).optional(),
  errorType: z.enum(Object.values(ErrorType) as [ErrorType, ...ErrorType[]]).optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/invoices/[id]/status">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return notFoundJson();

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid body", z.flattenError(parsed.error).fieldErrors);

  const result = await systemSetStatus(id, parsed.data, "api");
  if (!result.ok) {
    if (result.error === "Invoice not found") return notFoundJson();
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  revalidatePath("/dashboard/invoices", "layout");
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  return NextResponse.json({ from: result.from, to: result.to, invoice: serializeInvoice(invoice) });
}
