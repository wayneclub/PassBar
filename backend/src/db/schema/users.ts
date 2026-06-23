import {
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Auth.js core identity table.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('emailVerified', { withTimezone: true }),
  image: text('image'),
});

// PassBar-specific profile data, one-to-one with users (id shared).
export const profiles = pgTable('profiles', {
  id: uuid('id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').unique(),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('student'),
  status: text('status').notNull().default('pending'),
  studySettings: jsonb('study_settings').notNull(),
  examDate: date('exam_date'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
