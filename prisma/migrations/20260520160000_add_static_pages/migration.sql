-- CreateTable
CREATE TABLE "StaticPage" (
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "StaticPage_pkey" PRIMARY KEY ("slug")
);

-- Seed empty drafts for known legal/info slugs
INSERT INTO "StaticPage" ("slug", "title", "bodyMarkdown", "isPublished", "updatedAt") VALUES
  ('about', 'About us', '', false, CURRENT_TIMESTAMP),
  ('privacy', 'Privacy policy', '', false, CURRENT_TIMESTAMP),
  ('terms', 'Terms of service', '', false, CURRENT_TIMESTAMP),
  ('shipping', 'Shipping information', '', false, CURRENT_TIMESTAMP),
  ('returns', 'Returns policy', '', false, CURRENT_TIMESTAMP),
  ('faq', 'Frequently asked questions', '', false, CURRENT_TIMESTAMP);
