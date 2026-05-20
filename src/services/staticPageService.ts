import { HTTPException } from 'hono/http-exception';
import { STATIC_PAGE_SLUGS } from '../constants/staticPageDefaults.js';
import type { StaticPageSlug } from '../constants/staticPageDefaults.js';
import { prisma } from '../lib/prisma.js';
import type { StaticPageUpsertInput } from '../schemas/staticPage.js';
import { revalidateFrontendTags } from './revalidationService.js';

export type StaticPagePublic = {
  slug: string;
  title: string;
  bodyMarkdown: string;
  updatedAt: string;
};

export type StaticPageAdmin = StaticPagePublic & {
  isPublished: boolean;
};

function toPublic(row: {
  slug: string;
  title: string;
  bodyMarkdown: string;
  updatedAt: Date;
}): StaticPagePublic {
  return {
    slug: row.slug,
    title: row.title,
    bodyMarkdown: row.bodyMarkdown,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAdmin(row: {
  slug: string;
  title: string;
  bodyMarkdown: string;
  isPublished: boolean;
  updatedAt: Date;
}): StaticPageAdmin {
  return { ...toPublic(row), isPublished: row.isPublished };
}

export function assertStaticPageSlug(slug: string): StaticPageSlug {
  if (!(STATIC_PAGE_SLUGS as readonly string[]).includes(slug)) {
    throw new HTTPException(400, { message: `Unknown page slug: ${slug}` });
  }
  return slug as StaticPageSlug;
}

export async function getPublishedStaticPage(slug: string): Promise<StaticPagePublic | null> {
  const allowed = assertStaticPageSlug(slug);
  const row = await prisma.staticPage.findUnique({ where: { slug: allowed } });
  if (!row?.isPublished) return null;
  return toPublic(row);
}

export async function listAdminStaticPages(): Promise<StaticPageAdmin[]> {
  const rows = await prisma.staticPage.findMany({
    where: { slug: { in: [...STATIC_PAGE_SLUGS] } },
    orderBy: { slug: 'asc' },
  });
  return rows.map(toAdmin);
}

export async function upsertStaticPage(
  slug: string,
  input: StaticPageUpsertInput,
  userId: string,
): Promise<StaticPageAdmin> {
  const allowed = assertStaticPageSlug(slug);
  const row = await prisma.staticPage.upsert({
    where: { slug: allowed },
    create: {
      slug: allowed,
      title: input.title,
      bodyMarkdown: input.bodyMarkdown,
      isPublished: input.isPublished,
      updatedBy: userId,
    },
    update: {
      title: input.title,
      bodyMarkdown: input.bodyMarkdown,
      isPublished: input.isPublished,
      updatedBy: userId,
    },
  });
  await revalidateFrontendTags(['site-pages']);
  return toAdmin(row);
}
