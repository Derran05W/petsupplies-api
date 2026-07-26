import { prisma } from './src/lib/prisma.js';

const targets = await prisma.product.findMany({
  where: { slug: { startsWith: 'e2e_rev_' } },
  select: { id: true, name: true, slug: true },
});
console.log('deleting:', targets.map((t) => t.slug));
const res = await prisma.product.deleteMany({
  where: { slug: { startsWith: 'e2e_rev_' } },
});
console.log('deleted count:', res.count);
const remaining = await prisma.product.count();
console.log('remaining products:', remaining);
await prisma.$disconnect();
