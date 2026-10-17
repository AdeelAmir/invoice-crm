-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('INVOICE', 'RECEIPT', 'REMINDER', 'REPLY', 'ESCALATION', 'ALERT', 'CLIENT_MESSAGE');

-- CreateEnum
CREATE TYPE "EmailDelivery" AS ENUM ('OUTBOX', 'SENT', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "AgentTaskType" AS ENUM ('INVOICE_EMAIL', 'RECEIPT_EMAIL', 'REMINDER_EMAIL', 'CLIENT_REPLY', 'ADMIN_ALERT');

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditStep" ADD VALUE 'EMAIL_SENT';
ALTER TYPE "AuditStep" ADD VALUE 'CLIENT_REPLY';
ALTER TYPE "AuditStep" ADD VALUE 'ESCALATION';
ALTER TYPE "AuditStep" ADD VALUE 'AGENT_TASK';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "agentSessionId" TEXT,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "needsAttention" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "email_messages" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "direction" "EmailDirection" NOT NULL,
    "kind" "EmailKind" NOT NULL,
    "toAddress" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "delivery" "EmailDelivery" NOT NULL,
    "deliveredTo" TEXT,
    "providerId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tasks" (
    "id" SERIAL NOT NULL,
    "type" "AgentTaskType" NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_messages_invoiceId_createdAt_idx" ON "email_messages"("invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tasks_dedupeKey_key" ON "agent_tasks"("dedupeKey");

-- CreateIndex
CREATE INDEX "agent_tasks_status_createdAt_idx" ON "agent_tasks"("status", "createdAt");

-- CreateIndex
CREATE INDEX "agent_tasks_invoiceId_idx" ON "agent_tasks"("invoiceId");

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
