import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables for local testing/development
dotenv.config({ path: resolve(process.cwd(), '../.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }

  console.log('==> Connecting to database for migrations...');
  const pool = new Pool({
    connectionString,
    max: 1, // Only need 1 connection for running migrations
  });

  const db = drizzle(pool);

  // Resolve the migrations folder relative to the execution root (CWD)
  // In the production container, CWD is /app, and migrations are at /app/drizzle/migrations
  const migrationsFolder = resolve(process.cwd(), './drizzle/migrations');
  console.log(`==> Running migrations from folder: ${migrationsFolder}`);

  try {
    await migrate(db, { migrationsFolder });
    console.log('[✓] Migrations applied successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
