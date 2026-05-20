import { HTTPException } from 'hono/http-exception';
import type { ReplaceCategoryStripInput } from '../schemas/siteContent.js';
import { assertUniquePositions } from '../schemas/siteContent.js';
import { prisma } from '../lib/prisma.js';
import { revalidateFrontendTags } from './revalidationService.js';

export type CategoryStripItemPublic = {
  id: string;
  label: string;
  imageUrl: string | null;
  href: string;
  position: number;
  isActive: boolean;
};

function toPublicDto(row: {
  id: string;
  label: string;
  imageUrl: string | null;
  href: string;
  position: number;
  isActive: boolean;
}): CategoryStripItemPublic {
  return {
    id: row.id,
    label: row.label,
    imageUrl: row.imageUrl,
    href: row.href,
    position: row.position,
    isActive: row.isActive,
  };
}

export async function listCategoryStrip(): Promise<CategoryStripItemPublic[]> {
  const rows = await prisma.categoryStripItem.findMany({
    orderBy: { position: 'asc' },
  });
  return rows.map(toPublicDto);
}

export async function replaceCategoryStrip(
  items: ReplaceCategoryStripInput,
): Promise<CategoryStripItemPublic[]> {
  try {
    assertUniquePositions(items, 'category strip');
  } catch (e) {
    throw new HTTPException(400, {
      message: e instanceof Error ? e.message : 'Invalid category strip positions',
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.categoryStripItem.deleteMany();
    if (items.length > 0) {
      await tx.categoryStripItem.createMany({
        data: items.map((item) => ({
          label: item.label,
          imageUrl: item.imageUrl ?? null,
          href: item.href,
          position: item.position,
          isActive: item.isActive ?? true,
        })),
      });
    }
  });

  await revalidateFrontendTags(['site-category-strip']);
  return listCategoryStrip();
}
