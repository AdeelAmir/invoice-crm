import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-key";
import { badRequest, notFoundJson, parseInvoiceId } from "@/lib/api";
import { sendAgentEmail } from "@/lib/agent/emails";

// POST /api/agent/invoices/{id}/emails
// body: { kind: "INVOICE" | "RECEIPT" | "REMINDER" | "REPLY", subject, body }
// The CRM picks the recipient and appends the amounts and payment link.
// 409 when the rules do not allow this email now.
const bodySchema = z.object({
  kind: z.enum(["INVOICE", "RECEIPT", "REMINDER", "REPLY"]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
});

export async function POST(request: Request, ctx: RouteContext<"/api/agent/invoices/[id]/emails">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return notFoundJson();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid body", z.flattenError(parsed.error).fieldErrors);

  const { kind, subject, body } = parsed.data;
  const r = await sendAgentEmail(id, kind, { subject, body }, "agent");
  if (!r.ok && r.error === "Invoice not found") return notFoundJson();
  revalidatePath("/dashboard/invoices", "layout");
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
