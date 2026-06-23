import {
  bigint,
  bigserial,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

// Auth.js (NextAuth) standard tables — OAuth accounts, sessions, verification tokens.

export const accounts = pgTable(
  'accounts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: bigint('expires_at', { mode: 'number' }),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [unique().on(table.provider, table.providerAccountId)],
);

export const sessions = pgTable('sessions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
  sessionToken: text('sessionToken').notNull().unique(),
});

export const verificationTokens = pgTable(
  'verification_token',
  {
    identifier: text('identifier').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);
