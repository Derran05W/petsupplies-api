-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionInterval" AS ENUM ('WEEK_2', 'WEEK_4', 'WEEK_8', 'WEEK_12');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "subscriptionEligible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;

-- CreateTable
CREATE TABLE "ProductSubscriptionPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "interval" "SubscriptionInterval" NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSubscriptionPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "petId" TEXT,
    "quantity" INTEGER NOT NULL,
    "interval" "SubscriptionInterval" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "discountPercent" INTEGER NOT NULL DEFAULT 5,
    "nextDeliveryAt" TIMESTAMP(3) NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pausedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "subscriptionId" TEXT,
ADD COLUMN "subscriptionInvoiceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSubscriptionPrice_stripePriceId_key" ON "ProductSubscriptionPrice"("stripePriceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSubscriptionPrice_productId_interval_key" ON "ProductSubscriptionPrice"("productId", "interval");

-- CreateIndex
CREATE INDEX "ProductSubscriptionPrice_productId_active_idx" ON "ProductSubscriptionPrice"("productId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_userId_createdAt_idx" ON "Subscription"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Subscription_productId_idx" ON "Subscription"("productId");

-- CreateIndex
CREATE INDEX "Subscription_petId_idx" ON "Subscription"("petId");

-- CreateIndex
CREATE INDEX "Subscription_status_nextDeliveryAt_idx" ON "Subscription"("status", "nextDeliveryAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_subscriptionInvoiceId_key" ON "Order"("subscriptionInvoiceId");

-- CreateIndex
CREATE INDEX "Order_subscriptionId_idx" ON "Order"("subscriptionId");

-- AddForeignKey
ALTER TABLE "ProductSubscriptionPrice" ADD CONSTRAINT "ProductSubscriptionPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
