-- Apply this manually in the Supabase SQL editor (same pattern as sync_auth_user.sql).
-- Not managed by Prisma migrations — tsvector triggers must be applied outside the ORM.

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS "Product_searchVector_idx"
  ON "Product" USING GIN ("searchVector");

-- Trigger function
CREATE OR REPLACE FUNCTION update_product_search_vector()
RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('english', NEW.name || ' ' || NEW.description);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: fires before insert or update on Product
DROP TRIGGER IF EXISTS product_search_vector_update ON "Product";
CREATE TRIGGER product_search_vector_update
  BEFORE INSERT OR UPDATE ON "Product"
  FOR EACH ROW
  EXECUTE FUNCTION update_product_search_vector();
