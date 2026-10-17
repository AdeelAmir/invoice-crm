import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-key";
import { badRequest, parseInvoiceId } from "@/lib/api";
import { completeTask } from "@/lib/agent/tasks";

// POST /api/agent/tasks/{id}/complete  body: { result }
const bodySchema = z.object({ result: z.string().trim().max(5000).default("done") });

export async function POST(request: Request, ctx: RouteContext<"/api/agent/tasks/[id]/complete">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Invalid body", z.flattenError(parsed.error).fieldErrors);

  const r = await completeTask(id, parsed.data.result, "agent");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "Task not found" ? 404 : 409 });
  revalidatePath("/dashboard/invoices", "layout");
  return NextResponse.json(r);
}
