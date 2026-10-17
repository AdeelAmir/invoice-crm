import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireApiKey } from "@/lib/api-key";
import { parseInvoiceId } from "@/lib/api";
import { runCodeTask } from "@/lib/agent/emails";

// POST /api/agent/tasks/{id}/execute: run a task that needs no agent
// (ADMIN_ALERT) inside the CRM and close it.
export async function POST(request: Request, ctx: RouteContext<"/api/agent/tasks/[id]/execute">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const r = await runCodeTask(id, "agent-runner");
  revalidatePath("/dashboard/invoices", "layout");
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
