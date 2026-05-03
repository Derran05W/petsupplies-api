import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { env } from './types/env.js';

const app = createApp();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});
