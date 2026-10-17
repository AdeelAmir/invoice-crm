import { revalidatePath } from "next/cache";
import { requireApiKey } from "@/lib/api-key";
import { notFoundJson, parseInvoiceId, processResponse } from "@/lib/api";
import { retryInvoice } from "@/lib/invoices/service";

// POST /api/invoices/{id}/retry: same as the admin Retry button. Works on a
// FAILED invoice under the retry limit or one stuck in PROCESSING.
// 200 with outcome "created" or "failed"; 409 when it cannot be retried.
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/retry">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return notFoundJson();

  const result = await retryInvoice(id, "api");
  revalidatePath("/dashboard/invoices", "layout");
  return processResponse(id, result);
}
