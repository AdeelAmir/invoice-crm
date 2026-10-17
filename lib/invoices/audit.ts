import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { AuditResult, AuditStep } from "@/lib/generated/prisma/enums";

type Db = typeof prisma | Prisma.TransactionClient;

export type LogEntry = {
  invoiceId: number;
  step: AuditStep;
  result: AuditResult;
  message: string;
  actor: string;
  metadata?: Prisma.InputJsonValue;
};

// Append one entry to the invoice's audit log. Entries are never edited.
export async function logStep(entry: LogEntry, db: Db = prisma): Promise<void> {
  await db.auditLog.create({ data: entry });
}
