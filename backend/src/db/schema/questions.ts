import {
  bigserial,
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgView,
  primaryKey,
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
    subjectId: text('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
    source: text('source'),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    count: integer('count'),
    screenshotCount: integer('screenshot_count'),
    url: text('url'),
    examName: text('exam_name'),
    subject: text('subject').notNull(),
    chapter: text('chapter').notNull(),
    slug: text('slug').notNull(),
    rawMeta: jsonb('raw_meta'),
    sortOrder: integer('sort_order').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.subjectId, table.slug)],
);

export const questionItems = pgTable(
  'question_items',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    question: text('question').notNull(),
    correctAnswer: text('correct_answer').notNull(),
    sourceQuestion: text('source_question'),
    sourceChoices: jsonb('source_choices'),
    sourceCorrectAnswer: text('source_correct_answer'),
    sourceExplanationHtml: text('source_explanation_html'),
    apiQid: text('api_qid'),
    apiAnswerKey: text('api_answer_key'),
    apiMatchOk: boolean('api_match_ok'),
    apiMatchScore: numeric('api_match_score'),
    apiUrl: text('api_url'),
    apiStatus: integer('api_status'),
    topic: text('topic'),
    microConcept: text('micro_concept'),
    trapType: text('trap_type'),
    trapTypeIsNew: boolean('trap_type_is_new'),
    skillTested: text('skill_tested'),
    difficulty: text('difficulty'),
    keywordMeta: jsonb('keyword_meta'),
    highlightMeta: jsonb('highlight_meta'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.chapterId, table.index)],
);

export const questionTexts = pgTable(
  'question_texts',
  {
    questionId: text('question_id').notNull().references(() => questionItems.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
    source: text('source').notNull(),
    questionStem: text('question_stem').notNull(),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.questionId, table.language, table.source] })],
);

export const questionChoices = pgTable(
  'question_choices',
  {
    questionId: text('question_id').notNull().references(() => questionItems.id, { onDelete: 'cascade' }),
    language: text('language').notNull().default('en'),
    source: text('source').notNull().default('uworld'),
    choiceKey: text('choice_key').notNull(),
    choice: text('choice').notNull(),
    sortOrder: integer('sort_order').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.questionId, table.language, table.choiceKey] })],
);

export const questionExplanations = pgTable('question_explanations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  questionId: text('question_id').notNull().references(() => questionItems.id, { onDelete: 'cascade' }),
  language: text('language').notNull(),
  source: text('source').notNull().default('uworld'),
  explanationText: text('explanation_text'),
  explanationHtml: text('explanation_html'),
  mimeType: text('mime_type'),
  sortOrder: integer('sort_order').default(0),
  raw: jsonb('raw'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const questionAiExplanations = pgTable(
  'question_ai_explanations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    questionId: text('question_id').notNull().references(() => questionItems.id, { onDelete: 'cascade' }),
    selectedChoice: text('selected_choice'),
    correctChoice: text('correct_choice'),
    isCorrect: boolean('is_correct').notNull().default(false),
    interfaceLanguage: text('interface_language').notNull().default('zh-Hant'),
    promptVersion: text('prompt_version').notNull().default('question-analysis-v2'),
    source: text('source').notNull().default('gemini'),
    model: text('model'),
    analysisMarkdown: text('analysis_markdown').notNull(),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique().on(table.questionId, table.selectedChoice, table.correctChoice, table.interfaceLanguage, table.promptVersion),
  ],
);

export const questionReports = pgTable('question_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  questionId: text('question_id').notNull().references(() => questionItems.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'set null' }),
  category: text('category').notNull().default('other'),
  categories: text('categories').array(),
  language: text('language'),
  message: text('message'),
  resolved: boolean('resolved').notNull().default(false),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Read-only SQL views defined in legacy/supabase/schema.postgres.sql (public.question_chapter_counts, public.questions).

export const questionChapterCounts = pgView('question_chapter_counts', {
  subject: text('subject').notNull(),
  chapterId: text('chapter_id').notNull(),
  chapterName: text('chapter_name').notNull(),
  count: integer('count').notNull(),
}).existing();

export const questions = pgView('questions', {
  id: text('id').notNull(),
  index: integer('index').notNull(),
  subject: text('subject').notNull(),
  chapterId: text('chapter_id').notNull(),
  chapterName: text('chapter_name').notNull(),
  questionText: text('question_text').notNull(),
  fetchedQuestionStem: text('fetched_question_stem'),
  zhQuestionStem: text('zh_question_stem'),
  options: text('options').array().notNull(),
  bilingualOptions: text('bilingual_options').array().notNull(),
  zhOptions: text('zh_options').array().notNull(),
  correctAnswer: text('correct_answer'),
  bilingualCorrectAnswer: text('bilingual_correct_answer'),
  correctAnswerLetter: text('correct_answer_letter').notNull(),
  apiMatchOk: boolean('api_match_ok').notNull(),
  apiMatchScore: numeric('api_match_score'),
  apiQid: text('api_qid'),
  apiAnswerKey: text('api_answer_key'),
  enExplanationHtml: text('en_explanation_html'),
  explanationHtml: text('explanation_html'),
  topic: text('topic'),
  microConcept: text('micro_concept'),
  trapType: text('trap_type'),
  trapTypeIsNew: boolean('trap_type_is_new'),
  skillTested: text('skill_tested'),
  keywordMeta: jsonb('keyword_meta'),
  highlightMeta: jsonb('highlight_meta'),
  raw: jsonb('raw'),
}).existing();
