import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    staticPage: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/revalidationService.js', () => ({
  revalidateFrontendTags: vi.fn(),
}));

import { prisma } from '../../src/lib/prisma.js';
import * as staticPageService from '../../src/services/staticPageService.js';
import { revalidateFrontendTags } from '../../src/services/revalidationService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('staticPageService', () => {
  it('getPublishedStaticPage returns null when unpublished', async () => {
    vi.mocked(prisma.staticPage.findUnique).mockResolvedValue({
      slug: 'about',
      title: 'About',
      bodyMarkdown: '',
      isPublished: false,
      updatedAt: new Date(),
      updatedBy: null,
    });
    const page = await staticPageService.getPublishedStaticPage('about');
    expect(page).toBeNull();
  });

  it('getPublishedStaticPage returns public DTO when published', async () => {
    const updatedAt = new Date('2026-05-20T12:00:00.000Z');
    vi.mocked(prisma.staticPage.findUnique).mockResolvedValue({
      slug: 'about',
      title: 'About',
      bodyMarkdown: '# Hi',
      isPublished: true,
      updatedAt,
      updatedBy: 'admin-1',
    });
    const page = await staticPageService.getPublishedStaticPage('about');
    expect(page).toEqual({
      slug: 'about',
      title: 'About',
      bodyMarkdown: '# Hi',
      updatedAt: updatedAt.toISOString(),
    });
  });

  it('upsertStaticPage revalidates site-pages', async () => {
    vi.mocked(prisma.staticPage.upsert).mockResolvedValue({
      slug: 'faq',
      title: 'FAQ',
      bodyMarkdown: 'Q?',
      isPublished: true,
      updatedAt: new Date(),
      updatedBy: 'admin-1',
    });
    await staticPageService.upsertStaticPage(
      'faq',
      { title: 'FAQ', bodyMarkdown: 'Q?', isPublished: true },
      'admin-1',
    );
    expect(revalidateFrontendTags).toHaveBeenCalledWith(['site-pages']);
  });
});
