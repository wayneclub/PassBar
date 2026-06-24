import { date, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// PassBar-specific profile data. id has no local FK — existence is guaranteed by
// ensureProfile() (auth-service is the source of truth for the user record itself).
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email').unique(),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('student'),
  status: text('status').notNull().default('pending'),
  studySettings: jsonb('study_settings').notNull(),
  examDate: date('exam_date'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});
