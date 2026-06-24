import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { profiles } from './users';

// Local cache of login history pulled from auth-service (the source of truth for sessions).
// Refreshed lazily — see auth.service.ts syncLoginActivity — not written to directly.
export const loginActivity = pgTable('login_activity', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  loginCount: integer('login_count').notNull().default(0),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastLogoutAt: timestamp('last_logout_at', { withTimezone: true }),
  lastIp: text('last_ip'),
  lastDevice: text('last_device'),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
});
