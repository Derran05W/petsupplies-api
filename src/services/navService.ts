import { NavLocation } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';
import type { ReplaceFooterNavInput, ReplaceHeaderNavInput } from '../schemas/siteContent.js';
import { assertUniquePositions } from '../schemas/siteContent.js';
import { prisma } from '../lib/prisma.js';
import { revalidateFrontendTags } from './revalidationService.js';

export type NavLinkDto = {
  label: string;
  href: string;
  position: number;
};

export type FooterColumnDto = {
  column: { key: string; label: string; position: number };
  links: NavLinkDto[];
};

export type SiteNavPublic = {
  header: NavLinkDto[];
  footer: FooterColumnDto[];
};

function toNavLinkDto(link: { label: string; href: string; position: number }): NavLinkDto {
  return { label: link.label, href: link.href, position: link.position };
}

export async function getSiteNav(): Promise<SiteNavPublic> {
  const [headerLinks, footerColumns, footerLinks] = await Promise.all([
    prisma.navLink.findMany({
      where: { location: NavLocation.HEADER },
      orderBy: { position: 'asc' },
    }),
    prisma.footerColumn.findMany({
      orderBy: { position: 'asc' },
    }),
    prisma.navLink.findMany({
      where: { location: NavLocation.FOOTER },
      orderBy: { position: 'asc' },
    }),
  ]);

  const linksByColumn = new Map<string, NavLinkDto[]>();
  for (const link of footerLinks) {
    const key = link.columnKey ?? '';
    const list = linksByColumn.get(key) ?? [];
    list.push(toNavLinkDto(link));
    linksByColumn.set(key, list);
  }

  return {
    header: headerLinks.map(toNavLinkDto),
    footer: footerColumns.map((column) => ({
      column: { key: column.key, label: column.label, position: column.position },
      links: (linksByColumn.get(column.key) ?? []).sort((a, b) => a.position - b.position),
    })),
  };
}

export async function replaceHeaderNav(links: ReplaceHeaderNavInput): Promise<SiteNavPublic> {
  try {
    assertUniquePositions(links, 'header nav');
  } catch (e) {
    throw new HTTPException(400, {
      message: e instanceof Error ? e.message : 'Invalid header nav positions',
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.navLink.deleteMany({ where: { location: NavLocation.HEADER } });
    if (links.length > 0) {
      await tx.navLink.createMany({
        data: links.map((link) => ({
          label: link.label,
          href: link.href,
          position: link.position,
          location: NavLocation.HEADER,
        })),
      });
    }
  });

  await revalidateFrontendTags(['site-nav']);
  return getSiteNav();
}

export async function replaceFooterNav(columns: ReplaceFooterNavInput): Promise<SiteNavPublic> {
  try {
    assertUniquePositions(
      columns.map((c) => c.column),
      'footer columns',
    );
    for (const col of columns) {
      assertUniquePositions(col.links, `footer column "${col.column.key}"`);
    }
  } catch (e) {
    throw new HTTPException(400, {
      message: e instanceof Error ? e.message : 'Invalid footer nav positions',
    });
  }

  const columnKeys = columns.map((c) => c.column.key);
  if (new Set(columnKeys).size !== columnKeys.length) {
    throw new HTTPException(400, { message: 'Footer column keys must be unique' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.navLink.deleteMany({ where: { location: NavLocation.FOOTER } });
    await tx.footerColumn.deleteMany();

    if (columns.length > 0) {
      await tx.footerColumn.createMany({
        data: columns.map(({ column }) => ({
          key: column.key,
          label: column.label,
          position: column.position,
        })),
      });

      const footerLinks = columns.flatMap(({ column, links }) =>
        links.map((link) => ({
          label: link.label,
          href: link.href,
          position: link.position,
          location: NavLocation.FOOTER,
          columnKey: column.key,
        })),
      );

      if (footerLinks.length > 0) {
        await tx.navLink.createMany({ data: footerLinks });
      }
    }
  });

  await revalidateFrontendTags(['site-nav']);
  return getSiteNav();
}
