import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-key";
import { badRequest, notFoundJson, parseInvoiceId } from "@/lib/api";
import { escalateToAdmin } from "@/lib/agent/emails";

// POST /api/agent/invoices/{id}/escalate
// body: { category: "DISPUTE" | "REFUND" | "OTHER", summary, clientRequest?, recommendedAction? }
const bodySchema = z.object({
  category: z.enum(["DISPUTE", "REFUND", "OTHER"]),
  summary: z.string().trim().min(1).max(2000),
  clientRequest: z.string().trim().max(2000).optional(),
  recommendedAction: z.string().trim().max(2000).optional(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/agent/invoices/[id]/escalate">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return notFoundJson();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid body", z.flattenError(parsed.error).fieldErrors);

  const r = await escalateToAdmin(id, parsed.data, "agent");
  if (!r.ok && r.error === "Invoice not found") return notFoundJson();
  revalidatePath("/dashboard/invoices", "layout");
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
