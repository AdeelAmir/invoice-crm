import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-key";
import { badRequest, notFoundJson, parseInvoiceId } from "@/lib/api";
import { appendLog } from "@/lib/invoices/service";
import { AuditResult, AuditStep } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";

// POST /api/invoices/{id}/log
// body: { result: "SUCCESS" | "FAILURE", message, step?, metadata? }
const bodySchema = z.object({
  result: z.enum(Object.values(AuditResult) as [AuditResult, ...AuditResult[]]),
  message: z.string().trim().min(1).max(2000),
  step: z.enum(Object.values(AuditStep) as [AuditStep, ...AuditStep[]]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/log">) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const id = parseInvoiceId((await ctx.params).id);
  if (!id) return notFoundJson();

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid body", z.flattenError(parsed.error).fieldErrors);

  const ok = await appendLog(
    id,
    { ...parsed.data, metadata: parsed.data.metadata as Prisma.InputJsonValue | undefined },
    "api",
  );
  if (!ok) return notFoundJson();
  revalidatePath(`/dashboard/invoices/${id}`);
  return NextResponse.json({ logged: true }, { status: 201 });
}
