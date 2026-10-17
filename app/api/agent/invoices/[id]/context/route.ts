import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-key";
import { notFoundJson, parseInvoiceId } from "@/lib/api";
import { prisma } from "@/lib/db";
import { invoiceContext } from "@/lib/agent/emails";

// GET /api/agent/invoices/{id}/context: what the agent's get_invoice tool
// returns, plus the invoice's agent session id for the runner.
export async function GET(request: Request, ctx: RouteContext<"/api/agent/invoices/[id]/context">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return notFoundJson();

  const context = await invoiceContext(id);
  if (!context) return notFoundJson();
  const { agentSessionId } = await prisma.invoice.findUniqueOrThrow({ where: { id }, select: { agentSessionId: true } });
  return NextResponse.json({ agentSessionId, context });
}
