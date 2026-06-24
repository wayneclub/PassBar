import dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '../.env.local'), quiet: true });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
