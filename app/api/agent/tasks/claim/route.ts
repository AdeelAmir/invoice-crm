import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-key";
import { claimNextTask } from "@/lib/agent/tasks";

// POST /api/agent/tasks/claim: the next PENDING task, now RUNNING and owned
// by the caller; { task: null } when the queue is empty.
export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const task = await claimNextTask();
  return NextResponse.json({
    task: task && {
      id: task.id,
      type: task.type,
      invoiceId: task.invoiceId,
      payload: task.payload,
      attempts: task.attempts,
      invoice: task.invoice,
    },
  });
}
