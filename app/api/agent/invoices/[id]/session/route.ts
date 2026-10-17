import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-key";
import { badRequest, notFoundJson, parseInvoiceId } from "@/lib/api";
import { prisma } from "@/lib/db";

// PUT /api/agent/invoices/{id}/session  body: { sessionId }
// Records the Managed Agent session that handles this invoice.
const bodySchema = z.object({ sessionId: z.string().trim().min(1).max(200) });

export async function PUT(request: Request, ctx: RouteContext<"/api/agent/invoices/[id]/session">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return notFoundJson();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid body", z.flattenError(parsed.error).fieldErrors);

  const { count } = await prisma.invoice.updateMany({ where: { id }, data: { agentSessionId: parsed.data.sessionId } });
  if (count === 0) return notFoundJson();
  return NextResponse.json({ saved: true });
}
