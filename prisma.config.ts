import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL']!,
  },
  migrate: {
    async adapter(env) {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: env['DATABASE_URL'] });
      return new PrismaPg(pool);
    },
  },
});
