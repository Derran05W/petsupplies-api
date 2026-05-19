-- AlterTable
ALTER TABLE "Product" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE INDEX "Product_tags_idx" ON "Product" USING GIN ("tags");
