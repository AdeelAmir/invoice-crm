/*
  Warnings:

  - You are about to drop the column `description` on the `recurring_rules` table. All the data in the column will be lost.
  - You are about to drop the column `quantity` on the `recurring_rules` table. All the data in the column will be lost.
  - You are about to drop the column `termsDays` on the `recurring_rules` table. All the data in the column will be lost.
  - You are about to drop the column `unitPrice` on the `recurring_rules` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "BillingPlanType" AS ENUM ('NONE', 'ONE_TIME', 'MONTHLY');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "billingAmount" DECIMAL(12,2),
ADD COLUMN     "billingDate" DATE,
ADD COLUMN     "billingDescription" TEXT,
ADD COLUMN     "billingTermsDays" INTEGER,
ADD COLUMN     "billingType" "BillingPlanType" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "fromClientPlan" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "recurring_rules" DROP COLUMN "description",
DROP COLUMN "quantity",
DROP COLUMN "termsDays",
DROP COLUMN "unitPrice",
ADD COLUMN     "fromClientPlan" BOOLEAN NOT NULL DEFAULT false;
