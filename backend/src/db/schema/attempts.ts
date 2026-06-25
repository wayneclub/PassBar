import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { profiles } from './users';
import { questionItems } from './questions';

export const practiceSessions = pgTable('practice_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => profiles.id, {
    onDelete: 'cascade',
  }),
  mode: text('mode'),
  status: text('status').notNull().default('in_progress'),
  subjectIds: text('subject_ids').array().default([]),
  chapterIds: text('chapter_ids').array().default([]),
  questionCount: integer('question_count'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  totalTimeSeconds: integer('total_time_seconds').default(0),
  answeredCount: integer('answered_count').notNull().default(0),
  correctCount: integer('correct_count').notNull().default(0),
  userAgent: text('user_agent'),
  raw: jsonb('raw'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const practiceAnswers = pgTable(
  'practice_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => practiceSessions.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id').references(() => profiles.id, {
      onDelete: 'cascade',
    }),
    questionId: text('question_id')
      .notNull()
      .references(() => questionItems.id, { onDelete: 'cascade' }),
    selectedChoice: text('selected_choice').notNull(),
    correctAnswer: text('correct_answer').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    isMarked: boolean('is_marked').default(false),
    timeSpentSeconds: integer('time_spent_seconds').default(0),
    confidence: text('confidence'),
    changedAnswer: boolean('changed_answer').default(false),
    errorType: text('error_type'),
    previousIsCorrect: boolean('previous_is_correct'),
    answeredAt: timestamp('answered_at', { withTimezone: true }).defaultNow(),
    raw: jsonb('raw'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique().on(table.sessionId, table.questionId)],
);

export const userQuestionProgress = pgTable(
  'user_question_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questionItems.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    selectedChoice: text('selected_choice'),
    correctAnswer: text('correct_answer'),
    isCorrect: boolean('is_correct'),
    isMarked: boolean('is_marked').notNull().default(false),
    timesAnswered: integer('times_answered').notNull().default(0),
    timeSpentSeconds: integer('time_spent_seconds').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at', {
      withTimezone: true,
    }).defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
    lastAnsweredAt: timestamp('last_answered_at', { withTimezone: true }),
    raw: jsonb('raw'),
  },
  (table) => [primaryKey({ columns: [table.userId, table.questionId] })],
);

export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => profiles.id, {
    onDelete: 'set null',
  }),
  category: text('category'),
  subject: text('subject'),
  qid: text('qid'),
  refSubject: text('ref_subject'),
  refChapter: text('ref_chapter'),
  email: text('email'),
  message: text('message').notNull(),
  resolved: boolean('resolved').notNull().default(false),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const topicStudyProgress = pgTable(
  'topic_study_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id').notNull(),
    viewedCount: integer('viewed_count').notNull().default(0),
    lastQuestionId: text('last_question_id'),
    lastQuestionIndex: integer('last_question_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.userId, table.chapterId] })],
);

export const topicStudyQuestionStates = pgTable(
  'topic_study_question_states',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    chapterId: text('chapter_id'),
    isLearned: boolean('is_learned').notNull().default(false),
    isMarked: boolean('is_marked').notNull().default(false),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.questionId] })],
);

export const userConceptMastery = pgTable(
  'user_concept_mastery',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    topic: text('topic').notNull(),
    microConcept: text('micro_concept').notNull(),
    attempts: integer('attempts').notNull().default(0),
    correct: integer('correct').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    status: text('status').notNull().default('under-sampled'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.subject, table.topic, table.microConcept],
    }),
  ],
);

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const todos = pgTable('todos', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').notNull().default('new'),
  type: text('type').notNull().default('manual'),
  dueDate: date('due_date'),
  chapterId: text('chapter_id'),
  chapterIds: text('chapter_ids'),
  autoGenerated: boolean('auto_generated').notNull().default(false),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const userBadges = pgTable(
  'user_badges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    badgeKey: text('badge_key').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.userId, table.badgeKey)],
);
