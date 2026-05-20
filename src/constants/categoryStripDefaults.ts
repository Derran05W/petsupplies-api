/** Category strip defaults aligned with petsupplies-web CategoryStrip.tsx at planning time. */
export const CATEGORY_STRIP_DEFAULTS = [
  {
    label: 'Dogs',
    imageUrl: '/images/categories/dogs.jpg',
    href: '/products?category=DOG',
    position: 0,
    isActive: true,
  },
  {
    label: 'Cats',
    imageUrl: '/images/categories/cats.jpg',
    href: '/products?category=CAT',
    position: 1,
    isActive: true,
  },
  {
    label: 'Fish',
    imageUrl: '/images/categories/fish.jpg',
    href: '/products?category=FISH',
    position: 2,
    isActive: true,
  },
  {
    label: 'Birds',
    imageUrl: '/images/categories/birds.jpg',
    href: '/products?category=BIRD',
    position: 3,
    isActive: true,
  },
] as const;
