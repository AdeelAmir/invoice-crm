import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireApiKey } from "@/lib/api-key";
import { notFoundJson, parseInvoiceId } from "@/lib/api";
import { claimReminder } from "@/lib/invoices/reminders";

// POST /api/invoices/{id}/reminder: claim the next overdue reminder before
// sending it. 200 → send the email now; 409 → none due (or another run
// already claimed it), do not send. If sending then fails, report it with
// POST /api/invoices/{id}/log (step REMINDER, result FAILURE).
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/reminder">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return notFoundJson();

  const result = await claimReminder(id, "api");
  if (!result.found) return notFoundJson();
  if (!result.claimed) return NextResponse.json({ claimed: false, error: result.reason }, { status: 409 });
  revalidatePath(`/dashboard/invoices/${id}`);
  return NextResponse.json({ claimed: true, reminderNumber: result.reminderNumber });
}
