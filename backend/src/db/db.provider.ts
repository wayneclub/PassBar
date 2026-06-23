import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DB = Symbol('DB');

export type Database = NodePgDatabase<typeof schema>;

export const dbProvider: Provider = {
  provide: DB,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Database => {
    const pool = new Pool({ connectionString: config.getOrThrow<string>('DATABASE_URL') });
    return drizzle(pool, { schema });
  },
};
