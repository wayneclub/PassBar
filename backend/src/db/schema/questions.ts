import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  pgView,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { profiles } from './users';

export const subjects = pgTable('subjects', {
  id: text('id').primaryKey(),
  subject: text('subject').notNull().unique(),
  slug: text('slug').notNull().unique(),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const chapters = pgTable(
  'chapters',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    count: integer('count'),
    subject: text('subject').notNull(),
    chapter: text('chapter').notNull(),
    slug: text('slug').notNull(),
    sortOrder: integer('sort_order').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique().on(table.subjectId, table.slug)],
);

/** A question's bilingual stem/choices/explanation. Collapsed from separate per-language,
 * per-source tables into JSONB on `question_items` itself — every read path renders a whole
 * question (both languages) at once, so the old normalized shape only added join overhead
 * with no query ever filtering by language/source independently. */
export type QuestionStem = { en: string; zh?: string };
export type QuestionChoice = {
  key: 'a' | 'b' | 'c' | 'd';
  en: string;
  zh?: string;
  sortOrder: number;
  isCorrect: boolean;
};
export type QuestionExplanation = { en?: string; zh?: string };

export const questionItems = pgTable(
  'question_items',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    correctAnswer: text('correct_answer').notNull(),
    // Derived exclusively by the enriched importer from tags.includes('ncbe').
    // This denormalization keeps the common official-exam filter indexable instead of
    // requiring every request to inspect question_items.raw JSONB.
    isNcbe: boolean('is_ncbe').notNull().default(false),
    stem: jsonb('stem').$type<QuestionStem>().notNull(),
    choices: jsonb('choices').$type<QuestionChoice[]>().notNull(),
    explanation: jsonb('explanation').$type<QuestionExplanation>(),
    topic: text('topic'),
    microConcept: text('micro_concept'),
    trapType: text('trap_type'),
    trapTypeIsNew: boolean('trap_type_is_new'),
    skillTested: text('skill_tested'),
    keywordMeta: jsonb('keyword_meta'),
    highlightMeta: jsonb('highlight_meta'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique().on(table.chapterId, table.index)],
);

/** Queryable provenance for every source that maps to a canonical question.
 * `questionItems.isNcbe` remains the denormalized fast-path used by
 * the learner-facing source filter; this table supports audit/admin/future
 * provider-specific queries without inspecting raw JSONB. */
export const questionSources = pgTable(
  'question_sources',
  {
    questionId: text('question_id')
      .notNull()
      .references(() => questionItems.id, { onDelete: 'cascade' }),
    sourceUid: text('source_uid').notNull().unique(),
    provider: text('provider').notNull(),
    sourceType: text('source_type').notNull(),
    sourceFile: text('source_file'),
    sourceFormat: text('source_format'),
    sourceQuestionNumber: integer('source_question_number'),
    sourceSha256: text('source_sha256'),
    answerKey: text('answer_key'),
    isNcbe: boolean('is_ncbe').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique().on(table.questionId, table.sourceUid),
  ],
);

export const questionAiExplanations = pgTable(
  'question_ai_explanations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    questionId: text('question_id')
      .notNull()
      .references(() => questionItems.id, { onDelete: 'cascade' }),
    selectedChoice: text('selected_choice'),
    correctChoice: text('correct_choice'),
    isCorrect: boolean('is_correct').notNull().default(false),
    interfaceLanguage: text('interface_language').notNull().default('zh-Hant'),
    promptVersion: text('prompt_version')
      .notNull()
      .default('question-analysis-v2'),
    source: text('source').notNull().default('gemini'),
    model: text('model'),
    analysisMarkdown: text('analysis_markdown').notNull(),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique().on(
      table.questionId,
      table.selectedChoice,
      table.correctChoice,
      table.interfaceLanguage,
      table.promptVersion,
    ),
  ],
);

export const questionReports = pgTable('question_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  questionId: text('question_id')
    .notNull()
    .references(() => questionItems.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => profiles.id, {
    onDelete: 'set null',
  }),
  category: text('category').notNull().default('other'),
  categories: text('categories').array(),
  language: text('language'),
  message: text('message'),
  resolved: boolean('resolved').notNull().default(false),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Read-only SQL view defined in legacy/supabase/schema.postgres.sql.
// (The old `questions` view was dropped — question_items now carries the bilingual content
// directly as JSONB, so questions.service.ts queries it straight without a flattening view.)

export const questionChapterCounts = pgView('question_chapter_counts', {
  subject: text('subject').notNull(),
  chapterId: text('chapter_id').notNull(),
  chapterName: text('chapter_name').notNull(),
  count: integer('count').notNull(),
}).existing();
