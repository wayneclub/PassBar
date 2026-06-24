import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import {
  chapters,
  questionChapterCounts,
  questionItems,
  subjects,
  type QuestionChoice,
} from '../db/schema';

type QuestionItemRow = {
  id: string;
  index: number;
  correctAnswer: string;
  stem: { en: string; zh?: string };
  choices: QuestionChoice[];
  explanation: { en?: string; zh?: string } | null;
  topic: string | null;
  microConcept: string | null;
  trapType: string | null;
  skillTested: string | null;
  keywordMeta: unknown;
  highlightMeta: unknown;
  raw: unknown;
  chapterId: string;
  chapterName: string;
  subject: string;
};

const baseSelect = {
  id: questionItems.id,
  index: questionItems.index,
  correctAnswer: questionItems.correctAnswer,
  stem: questionItems.stem,
  choices: questionItems.choices,
  explanation: questionItems.explanation,
  topic: questionItems.topic,
  microConcept: questionItems.microConcept,
  trapType: questionItems.trapType,
  skillTested: questionItems.skillTested,
  keywordMeta: questionItems.keywordMeta,
  highlightMeta: questionItems.highlightMeta,
  raw: questionItems.raw,
  chapterId: chapters.id,
  chapterName: chapters.chapter,
  subject: subjects.subject,
};

/** Shapes a question_items row into the flat object the frontend has always consumed
 * (see frontend/src/lib/question-bank.ts QuestionRow) — kept identical on purpose so the
 * frontend needed no changes when the old questions SQL view was replaced by this query.
 * `fetchedQuestionStem`/`bilingualOptions`/`apiAnswerKey`/`apiMatchOk` are dead fields from a
 * never-used "mixed language" / UWorld-matching feature; both were always empty even under
 * the old view, kept here only for response-shape compatibility. */
function toQuestionRow(row: QuestionItemRow) {
  const sortedChoices = [...row.choices].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  return {
    id: row.id,
    index: row.index,
    subject: row.subject,
    chapterId: row.chapterId,
    chapterName: row.chapterName,
    questionText: row.stem.en,
    fetchedQuestionStem: null,
    zhQuestionStem: row.stem.zh ?? null,
    options: sortedChoices.filter((c) => c.en).map((c) => c.en),
    bilingualOptions: [],
    zhOptions: sortedChoices.filter((c) => c.zh).map((c) => c.zh as string),
    correctAnswer: sortedChoices.find((c) => c.isCorrect)?.en ?? null,
    correctAnswerLetter: row.correctAnswer,
    apiAnswerKey: null,
    apiMatchOk: true,
    enExplanationHtml: row.explanation?.en ?? null,
    explanationHtml: row.explanation?.zh ?? null,
    topic: row.topic,
    microConcept: row.microConcept,
    trapType: row.trapType,
    skillTested: row.skillTested,
    keywordMeta: row.keywordMeta,
    highlightMeta: row.highlightMeta,
    raw: row.raw,
  };
}

@Injectable()
export class QuestionsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async getSubjects() {
    return this.db
      .select()
      .from(questionChapterCounts)
      .orderBy(
        asc(questionChapterCounts.subject),
        asc(questionChapterCounts.chapterName),
      );
  }

  async getSubjectsGrouped(): Promise<
    Array<{
      id: string;
      name: string;
      count: number;
      chapters: Array<{ id: string; name: string; count: number }>;
    }>
  > {
    const rows = await this.getSubjects();
    const grouped = new Map<
      string,
      {
        id: string;
        name: string;
        count: number;
        chapters: Array<{ id: string; name: string; count: number }>;
      }
    >();

    rows.forEach((row) => {
      const existing = grouped.get(row.subject) ?? {
        id: row.subject
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        name: row.subject,
        count: 0,
        chapters: [],
      };
      existing.count += row.count;
      existing.chapters.push({
        id: row.chapterId,
        name: row.chapterName,
        count: row.count,
      });
      grouped.set(row.subject, existing);
    });

    return Array.from(grouped.values()).filter((s) => s.count > 0);
  }

  private joinedQuery() {
    return this.db
      .select(baseSelect)
      .from(questionItems)
      .innerJoin(chapters, eq(chapters.id, questionItems.chapterId))
      .innerJoin(subjects, eq(subjects.id, chapters.subjectId));
  }

  async getQuestionIdsByChapterIds(chapterIds: string[]): Promise<string[]> {
    if (chapterIds.length === 0) return [];
    const rows = await this.db
      .select({ id: questionItems.id })
      .from(questionItems)
      .where(inArray(questionItems.chapterId, chapterIds));
    return rows.map((r) => r.id);
  }

  async getAllQuestionIdsByChapter(): Promise<Record<string, string[]>> {
    const rows = await this.db
      .select({ id: questionItems.id, chapterId: questionItems.chapterId })
      .from(questionItems);
    const map: Record<string, string[]> = {};
    for (const row of rows) {
      (map[row.chapterId] ??= []).push(row.id);
    }
    return map;
  }

  async getQuestionsByChapterIds(chapterIds: string[], limit: number) {
    if (chapterIds.length === 0) return [];
    const rows = await this.joinedQuery()
      .where(inArray(questionItems.chapterId, chapterIds))
      .orderBy(asc(questionItems.chapterId), asc(questionItems.index))
      .limit(limit);
    return rows.map(toQuestionRow);
  }

  async getQuestionsByIds(questionIds: string[]) {
    if (questionIds.length === 0) return [];
    const rows = await this.joinedQuery().where(
      inArray(questionItems.id, questionIds),
    );
    return rows.map(toQuestionRow);
  }
}
