-- AlterTable
ALTER TABLE "recurring_rules" ADD COLUMN     "description" TEXT,
ADD COLUMN     "quantity" DECIMAL(10,2),
ADD COLUMN     "stoppedAt" TIMESTAMP(3),
ADD COLUMN     "termsDays" INTEGER,
ADD COLUMN     "unitPrice" DECIMAL(12,2);
