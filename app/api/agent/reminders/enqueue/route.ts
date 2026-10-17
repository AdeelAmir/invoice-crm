import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireApiKey } from "@/lib/api-key";
import { enqueueDueReminders } from "@/lib/agent/emails";

// POST /api/agent/reminders/enqueue: claim every overdue reminder that is
// due now and queue a REMINDER_EMAIL task for each. Safe to call often.
export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const queued = await enqueueDueReminders("agent-runner");
  if (queued > 0) revalidatePath("/dashboard/invoices", "layout");
  return NextResponse.json({ queued });
}
