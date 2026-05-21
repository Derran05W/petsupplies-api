export const STATIC_PAGE_SLUGS = [
  'about',
  'privacy',
  'terms',
  'shipping',
  'returns',
  'faq',
] as const;

export type StaticPageSlug = (typeof STATIC_PAGE_SLUGS)[number];

export const STATIC_PAGE_SEED_DEFAULTS: Array<{
  slug: StaticPageSlug;
  title: string;
  bodyMarkdown: string;
}> = [
  { slug: 'about', title: 'About us', bodyMarkdown: '' },
  { slug: 'privacy', title: 'Privacy policy', bodyMarkdown: '' },
  { slug: 'terms', title: 'Terms of service', bodyMarkdown: '' },
  { slug: 'shipping', title: 'Shipping information', bodyMarkdown: '' },
  { slug: 'returns', title: 'Returns policy', bodyMarkdown: '' },
  { slug: 'faq', title: 'Frequently asked questions', bodyMarkdown: '' },
];
