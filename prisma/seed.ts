import 'dotenv/config';
import { PrismaClient, ProductCategory, NavLocation } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { buildSiteSettingsSeedData } from '../src/constants/siteSettingsDefaults.js';
import {
  SITE_FOOTER_DEFAULTS,
  SITE_HEADER_NAV_DEFAULTS,
} from '../src/constants/siteNavDefaults.js';
import { CATEGORY_STRIP_DEFAULTS } from '../src/constants/categoryStripDefaults.js';
import { STATIC_PAGE_SEED_DEFAULTS } from '../src/constants/staticPageDefaults.js';
import { EMAIL_TEMPLATE_SEED_DEFAULTS } from '../src/constants/emailTemplateDefaults.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const products = [
  {
    slug: 'royal-canin-adult-dry',
    name: 'Royal Canin Adult Dry Dog Food',
    description: 'Complete nutrition for adult dogs. Supports digestive health and a shiny coat.',
    price: 5499,
    imageUrl: null,
    stock: 120,
    category: ProductCategory.DOG,
    categories: [ProductCategory.DOG],
  },
  {
    slug: 'hills-science-diet-cat',
    name: "Hill's Science Diet Adult Cat Food",
    description: 'Precisely balanced nutrition with high-quality protein for adult cats.',
    price: 3999,
    imageUrl: null,
    stock: 85,
    category: ProductCategory.CAT,
    categories: [ProductCategory.CAT],
  },
  {
    slug: 'kong-classic-medium',
    name: 'KONG Classic Dog Toy - Medium',
    description: 'Durable rubber chew toy. Fill with treats to keep your dog mentally stimulated.',
    price: 1299,
    imageUrl: null,
    stock: 200,
    category: ProductCategory.DOG,
    categories: [ProductCategory.DOG],
  },
  {
    slug: 'furminator-deshedding-tool',
    name: 'FURminator deShedding Tool for Dogs',
    description:
      'Reduces shedding up to 90%. Reaches through topcoat to remove loose undercoat fur.',
    price: 4499,
    imageUrl: null,
    stock: 60,
    category: ProductCategory.ACCESSORIES,
    categories: [ProductCategory.ACCESSORIES, ProductCategory.DOG],
  },
  {
    slug: 'blue-buffalo-life-protection',
    name: 'Blue Buffalo Life Protection Dog Food',
    description:
      'Real chicken and wholesome grains. No poultry by-products or artificial flavours.',
    price: 6299,
    imageUrl: null,
    stock: 95,
    category: ProductCategory.DOG,
    categories: [ProductCategory.DOG],
  },
  {
    slug: 'whiskas-wet-cat-food-pack',
    name: 'Whiskas Wet Cat Food Variety Pack',
    description: '12-pouch variety pack with chicken, tuna, and beef. 85g pouches.',
    price: 1499,
    imageUrl: null,
    stock: 300,
    category: ProductCategory.CAT,
    categories: [ProductCategory.CAT],
  },
  {
    slug: 'petsafe-automatic-feeder',
    name: 'PetSafe Automatic Pet Feeder',
    description: 'Programmable 5-meal feeder. Portion control for cats and small dogs.',
    price: 8999,
    imageUrl: null,
    stock: 40,
    category: ProductCategory.ACCESSORIES,
    categories: [ProductCategory.ACCESSORIES, ProductCategory.CAT, ProductCategory.DOG],
  },
  {
    slug: 'adaptil-dog-calming-collar',
    name: 'ADAPTIL Calming Collar for Dogs',
    description: 'Releases calming pheromones to reduce anxiety. Lasts up to 4 weeks. Adjustable.',
    price: 2999,
    imageUrl: null,
    stock: 75,
    category: ProductCategory.DOG,
    categories: [ProductCategory.DOG],
  },
  {
    slug: 'aqueon-fish-tank-20gal',
    name: 'Aqueon LED Aquarium Kit 20 Gallon',
    description: 'Complete starter kit with filter, heater, thermometer, fish net, and fish food.',
    price: 14999,
    imageUrl: null,
    stock: 25,
    category: ProductCategory.FISH,
    categories: [ProductCategory.FISH],
  },
  {
    slug: 'frontline-plus-flea-tick',
    name: 'Frontline Plus Flea & Tick Treatment',
    description: '3-month supply. Kills fleas, ticks, and chewing lice. Waterproof after 24 hours.',
    price: 3799,
    imageUrl: null,
    stock: 150,
    category: ProductCategory.HEALTH,
    categories: [ProductCategory.HEALTH],
  },
];

function shippingSeedEnv(): { freeShippingThresholdCents: number; flatShippingCents: number } {
  const freeShippingThresholdCents = Number(process.env.FREE_SHIPPING_THRESHOLD_CENTS ?? 5000);
  const flatShippingCents = Number(process.env.FLAT_SHIPPING_CENTS ?? 599);
  return { freeShippingThresholdCents, flatShippingCents };
}

async function main() {
  console.log('Seeding database...');

  await prisma.siteSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: buildSiteSettingsSeedData(shippingSeedEnv()),
  });
  console.log('Seeded SiteSettings singleton.');

  const headerCount = await prisma.navLink.count({ where: { location: NavLocation.HEADER } });
  if (headerCount === 0) {
    await prisma.navLink.createMany({
      data: SITE_HEADER_NAV_DEFAULTS.map((link) => ({
        ...link,
        location: NavLocation.HEADER,
      })),
    });
    console.log(`Seeded ${SITE_HEADER_NAV_DEFAULTS.length} header nav links.`);
  }

  const footerColumnCount = await prisma.footerColumn.count();
  if (footerColumnCount === 0) {
    await prisma.footerColumn.createMany({
      data: SITE_FOOTER_DEFAULTS.map(({ column }) => column),
    });
    await prisma.navLink.createMany({
      data: SITE_FOOTER_DEFAULTS.flatMap(({ column, links }) =>
        links.map((link) => ({
          ...link,
          location: NavLocation.FOOTER,
          columnKey: column.key,
        })),
      ),
    });
    console.log(`Seeded ${SITE_FOOTER_DEFAULTS.length} footer columns with links.`);
  }

  const categoryStripCount = await prisma.categoryStripItem.count();
  if (categoryStripCount === 0) {
    await prisma.categoryStripItem.createMany({
      data: CATEGORY_STRIP_DEFAULTS.map((item) => ({ ...item })),
    });
    console.log(`Seeded ${CATEGORY_STRIP_DEFAULTS.length} category strip items.`);
  }

  for (const page of STATIC_PAGE_SEED_DEFAULTS) {
    await prisma.staticPage.upsert({
      where: { slug: page.slug },
      update: {},
      create: {
        slug: page.slug,
        title: page.title,
        bodyMarkdown: page.bodyMarkdown,
        isPublished: false,
      },
    });
  }
  console.log(`Ensured ${STATIC_PAGE_SEED_DEFAULTS.length} static page drafts.`);

  for (const template of EMAIL_TEMPLATE_SEED_DEFAULTS) {
    await prisma.emailTemplate.upsert({
      where: { key: template.key },
      update: {},
      create: {
        key: template.key,
        subject: template.subject,
        preheader: template.preheader,
        bodyMarkdown: template.bodyMarkdown,
      },
    });
  }
  console.log(`Ensured ${EMAIL_TEMPLATE_SEED_DEFAULTS.length} email templates.`);

  for (const product of products) {
    const upserted = await prisma.product.upsert({
      where: { slug: product.slug },
      update: { category: product.category, categories: product.categories },
      create: product,
    });

    const imageUrl =
      product.imageUrl ?? `https://placehold.co/600x400?text=${encodeURIComponent(product.name)}`;
    await prisma.productImage.upsert({
      where: { id: `img-${upserted.id}` },
      update: { url: imageUrl },
      create: {
        id: `img-${upserted.id}`,
        productId: upserted.id,
        url: imageUrl,
        isPrimary: true,
        sortOrder: 0,
      },
    });
  }

  await prisma.$executeRaw`
    UPDATE "Product"
    SET "searchVector" = to_tsvector('english', name || ' ' || description)
  `;

  console.log(`Seeded ${products.length} products with images and search vectors.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
