-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "weightGrams" INTEGER,
ADD COLUMN     "lengthCm" INTEGER,
ADD COLUMN     "widthCm" INTEGER,
ADD COLUMN     "heightCm" INTEGER,
ADD COLUMN     "shipsSeparately" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shipCarrier" TEXT,
ADD COLUMN     "shipServiceCode" TEXT,
ADD COLUMN     "shipServiceName" TEXT,
ADD COLUMN     "shipEstimatedDeliveryDays" INTEGER,
ADD COLUMN     "shipQuoteSource" TEXT;
