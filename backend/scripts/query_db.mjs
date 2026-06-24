import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load env
dotenv.config({ path: resolve(process.cwd(), '../.env.local') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
});

async function main() {
  await client.connect();
  try {
    const users = await client.query("SELECT * FROM auth.users");
    console.log('\n--- auth.users ---');
    console.table(users.rows.map(u => ({ id: u.id, email: u.email, name: u.name })));

    const profiles = await client.query("SELECT id, email, role, status FROM public.profiles");
    console.log('\n--- public.profiles ---');
    console.table(profiles.rows);
  } catch (err) {
    console.error('Query error:', err);
  } finally {
    await client.end();
  }
}

main();
