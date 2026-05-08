-- AlterTable
ALTER TABLE "Cart" ADD COLUMN     "lastAbandonedEmailAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Cart_updatedAt_lastAbandonedEmailAt_idx" ON "Cart"("updatedAt", "lastAbandonedEmailAt");
