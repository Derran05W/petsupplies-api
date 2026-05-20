import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';
import { withInStock } from './productService.js';
import { revalidateFrontendTags } from './revalidationService.js';

const MAX_FEATURED = 8;

const productInclude = {
  images: { orderBy: { sortOrder: 'asc' as const } },
};

export type FeaturedProductPublic = ReturnType<
  typeof withInStock<Awaited<ReturnType<typeof prisma.product.findMany>>[number]>
>;

export async function listFeaturedProducts(): Promise<FeaturedProductPublic[]> {
  const rows = await prisma.featuredProduct.findMany({
    orderBy: { position: 'asc' },
    include: {
      product: {
        include: productInclude,
      },
    },
  });

  return rows.filter((row) => row.product.active).map((row) => withInStock(row.product));
}

export async function replaceFeaturedProducts(
  productIds: string[],
): Promise<FeaturedProductPublic[]> {
  if (productIds.length > MAX_FEATURED) {
    throw new HTTPException(400, {
      message: `At most ${MAX_FEATURED} featured products allowed`,
    });
  }

  const uniqueIds = new Set(productIds);
  if (uniqueIds.size !== productIds.length) {
    throw new HTTPException(400, { message: 'Duplicate product IDs are not allowed' });
  }

  if (productIds.length > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, active: true, name: true },
    });

    if (products.length !== productIds.length) {
      const found = new Set(products.map((p) => p.id));
      const missing = productIds.filter((id) => !found.has(id));
      throw new HTTPException(400, {
        message: `Unknown product ID(s): ${missing.join(', ')}`,
      });
    }

    const inactive = products.filter((p) => !p.active);
    if (inactive.length > 0) {
      throw new HTTPException(400, {
        message: `Inactive products cannot be featured: ${inactive.map((p) => p.name).join(', ')}`,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.featuredProduct.deleteMany();
    if (productIds.length > 0) {
      await tx.featuredProduct.createMany({
        data: productIds.map((productId, index) => ({
          productId,
          position: index,
        })),
      });
    }
  });

  await revalidateFrontendTags(['site-featured']);
  return listFeaturedProducts();
}
