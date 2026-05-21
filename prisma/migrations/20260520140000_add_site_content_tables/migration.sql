-- CreateEnum
CREATE TYPE "NavLocation" AS ENUM ('HEADER', 'FOOTER');

-- CreateTable
CREATE TABLE "FeaturedProduct" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "FeaturedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NavLink" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "location" "NavLocation" NOT NULL,
    "columnKey" TEXT,

    CONSTRAINT "NavLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FooterColumn" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "FooterColumn_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CategoryStripItem" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "imageUrl" TEXT,
    "href" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CategoryStripItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedProduct_productId_key" ON "FeaturedProduct"("productId");

-- CreateIndex
CREATE INDEX "FeaturedProduct_position_idx" ON "FeaturedProduct"("position");

-- CreateIndex
CREATE INDEX "NavLink_location_position_idx" ON "NavLink"("location", "position");

-- CreateIndex
CREATE INDEX "CategoryStripItem_position_idx" ON "CategoryStripItem"("position");

-- AddForeignKey
ALTER TABLE "FeaturedProduct" ADD CONSTRAINT "FeaturedProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed header nav (aligned with petsupplies-web NavLinks.tsx at planning time)
INSERT INTO "NavLink" ("id", "label", "href", "position", "location", "columnKey") VALUES
  ('nav-header-home', 'Home', '/', 0, 'HEADER', NULL),
  ('nav-header-dogs', 'Dogs', '/products?category=DOG', 1, 'HEADER', NULL),
  ('nav-header-cats', 'Cats', '/products?category=CAT', 2, 'HEADER', NULL),
  ('nav-header-fish', 'Fish', '/products?category=FISH', 3, 'HEADER', NULL),
  ('nav-header-birds', 'Birds', '/products?category=BIRD', 4, 'HEADER', NULL);

-- Seed footer columns + links (Shop / Help / Company — real paths where obvious)
INSERT INTO "FooterColumn" ("key", "label", "position") VALUES
  ('shop', 'Shop', 0),
  ('help', 'Help', 1),
  ('company', 'Company', 2);

INSERT INTO "NavLink" ("id", "label", "href", "position", "location", "columnKey") VALUES
  ('nav-footer-shop-all', 'All products', '/products', 0, 'FOOTER', 'shop'),
  ('nav-footer-shop-dogs', 'Dog supplies', '/products?category=DOG', 1, 'FOOTER', 'shop'),
  ('nav-footer-shop-cats', 'Cat supplies', '/products?category=CAT', 2, 'FOOTER', 'shop'),
  ('nav-footer-shop-accessories', 'Accessories', '/products?category=ACCESSORIES', 3, 'FOOTER', 'shop'),
  ('nav-footer-help-shipping', 'Shipping info', '/shipping', 0, 'FOOTER', 'help'),
  ('nav-footer-help-returns', 'Returns', '/returns', 1, 'FOOTER', 'help'),
  ('nav-footer-help-faq', 'FAQ', '/faq', 2, 'FOOTER', 'help'),
  ('nav-footer-help-contact', 'Contact us', 'mailto:hello@aileenspetstore.com', 3, 'FOOTER', 'help'),
  ('nav-footer-co-about', 'About us', '/about', 0, 'FOOTER', 'company'),
  ('nav-footer-co-privacy', 'Privacy policy', '/privacy', 1, 'FOOTER', 'company'),
  ('nav-footer-co-terms', 'Terms of service', '/terms', 2, 'FOOTER', 'company'),
  ('nav-footer-co-careers', 'Careers', '/coming-soon', 3, 'FOOTER', 'company');

-- Seed category strip (aligned with petsupplies-web CategoryStrip.tsx at planning time)
INSERT INTO "CategoryStripItem" ("id", "label", "imageUrl", "href", "position", "isActive") VALUES
  ('cat-strip-dogs', 'Dogs', '/images/categories/dogs.jpg', '/products?category=DOG', 0, true),
  ('cat-strip-cats', 'Cats', '/images/categories/cats.jpg', '/products?category=CAT', 1, true),
  ('cat-strip-fish', 'Fish', '/images/categories/fish.jpg', '/products?category=FISH', 2, true),
  ('cat-strip-birds', 'Birds', '/images/categories/birds.jpg', '/products?category=BIRD', 3, true);
