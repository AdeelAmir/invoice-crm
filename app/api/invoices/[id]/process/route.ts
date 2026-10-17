import { revalidatePath } from "next/cache";
import { requireApiKey } from "@/lib/api-key";
import { notFoundJson, parseInvoiceId, processResponse } from "@/lib/api";
import { processInvoice } from "@/lib/invoices/processor";

// POST /api/invoices/{id}/process: run the full flow on a PENDING invoice
// (claim → gateway → CREATED → next recurring occurrence).
// 200 with outcome "created" or "failed"; 409 when it did not run.
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/process">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return notFoundJson();

  const result = await processInvoice(id, "api");
  revalidatePath("/dashboard/invoices", "layout");
  return processResponse(id, result);
}
