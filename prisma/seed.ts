import 'dotenv/config';
import { PrismaClient, ProductCategory } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

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
  },
  {
    slug: 'hills-science-diet-cat',
    name: "Hill's Science Diet Adult Cat Food",
    description: 'Precisely balanced nutrition with high-quality protein for adult cats.',
    price: 3999,
    imageUrl: null,
    stock: 85,
    category: ProductCategory.CAT,
  },
  {
    slug: 'kong-classic-medium',
    name: 'KONG Classic Dog Toy - Medium',
    description: 'Durable rubber chew toy. Fill with treats to keep your dog mentally stimulated.',
    price: 1299,
    imageUrl: null,
    stock: 200,
    category: ProductCategory.DOG,
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
  },
  {
    slug: 'whiskas-wet-cat-food-pack',
    name: 'Whiskas Wet Cat Food Variety Pack',
    description: '12-pouch variety pack with chicken, tuna, and beef. 85g pouches.',
    price: 1499,
    imageUrl: null,
    stock: 300,
    category: ProductCategory.CAT,
  },
  {
    slug: 'petsafe-automatic-feeder',
    name: 'PetSafe Automatic Pet Feeder',
    description: 'Programmable 5-meal feeder. Portion control for cats and small dogs.',
    price: 8999,
    imageUrl: null,
    stock: 40,
    category: ProductCategory.ACCESSORIES,
  },
  {
    slug: 'adaptil-dog-calming-collar',
    name: 'ADAPTIL Calming Collar for Dogs',
    description: 'Releases calming pheromones to reduce anxiety. Lasts up to 4 weeks. Adjustable.',
    price: 2999,
    imageUrl: null,
    stock: 75,
    category: ProductCategory.DOG,
  },
  {
    slug: 'aqueon-fish-tank-20gal',
    name: 'Aqueon LED Aquarium Kit 20 Gallon',
    description: 'Complete starter kit with filter, heater, thermometer, fish net, and fish food.',
    price: 14999,
    imageUrl: null,
    stock: 25,
    category: ProductCategory.FISH,
  },
  {
    slug: 'frontline-plus-flea-tick',
    name: 'Frontline Plus Flea & Tick Treatment',
    description: '3-month supply. Kills fleas, ticks, and chewing lice. Waterproof after 24 hours.',
    price: 3799,
    imageUrl: null,
    stock: 150,
    category: ProductCategory.HEALTH,
  },
];

async function main() {
  console.log('Seeding database...');

  for (const product of products) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: { category: product.category },
      create: product,
    });
  }

  console.log(`Seeded ${products.length} products.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
