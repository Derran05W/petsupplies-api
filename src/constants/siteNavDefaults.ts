/** Header + footer nav defaults aligned with petsupplies-web at planning time. */
export const SITE_HEADER_NAV_DEFAULTS = [
  { label: 'Home', href: '/', position: 0 },
  { label: 'Dogs', href: '/products?category=DOG', position: 1 },
  { label: 'Cats', href: '/products?category=CAT', position: 2 },
  { label: 'Fish', href: '/products?category=FISH', position: 3 },
  { label: 'Birds', href: '/products?category=BIRD', position: 4 },
] as const;

export const SITE_FOOTER_DEFAULTS = [
  {
    column: { key: 'shop', label: 'Shop', position: 0 },
    links: [
      { label: 'All products', href: '/products', position: 0 },
      { label: 'Dog supplies', href: '/products?category=DOG', position: 1 },
      { label: 'Cat supplies', href: '/products?category=CAT', position: 2 },
      { label: 'Accessories', href: '/products?category=ACCESSORIES', position: 3 },
    ],
  },
  {
    column: { key: 'help', label: 'Help', position: 1 },
    links: [
      { label: 'Shipping info', href: '/shipping', position: 0 },
      { label: 'Returns', href: '/returns', position: 1 },
      { label: 'FAQ', href: '/faq', position: 2 },
      { label: 'Contact us', href: 'mailto:hello@aileenspetstore.com', position: 3 },
    ],
  },
  {
    column: { key: 'company', label: 'Company', position: 2 },
    links: [
      { label: 'About us', href: '/about', position: 0 },
      { label: 'Privacy policy', href: '/privacy', position: 1 },
      { label: 'Terms of service', href: '/terms', position: 2 },
      { label: 'Careers', href: '/coming-soon', position: 3 },
    ],
  },
] as const;
