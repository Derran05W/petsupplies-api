ALTER TABLE "Product" ADD COLUMN "categories" "ProductCategory"[] NOT NULL DEFAULT '{}';
UPDATE "Product" SET "categories" = ARRAY["category"];
CREATE INDEX "Product_categories_idx" ON "Product" USING GIN ("categories");
