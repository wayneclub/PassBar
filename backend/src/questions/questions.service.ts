import { Inject, Injectable } from '@nestjs/common';
import { asc, inArray } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { questionChapterCounts, questions } from '../db/schema';

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

  async getQuestionIdsByChapterIds(chapterIds: string[]): Promise<string[]> {
    if (chapterIds.length === 0) return [];
    const rows = await this.db
      .select({ id: questions.id })
      .from(questions)
      .where(inArray(questions.chapterId, chapterIds));
    return rows.map((r) => r.id);
  }

  async getAllQuestionIdsByChapter(): Promise<Record<string, string[]>> {
    const rows = await this.db
      .select({ id: questions.id, chapterId: questions.chapterId })
      .from(questions);
    const map: Record<string, string[]> = {};
    for (const row of rows) {
      (map[row.chapterId] ??= []).push(row.id);
    }
    return map;
  }

  async getQuestionsByChapterIds(chapterIds: string[], limit: number) {
    if (chapterIds.length === 0) return [];
    return this.db
      .select()
      .from(questions)
      .where(inArray(questions.chapterId, chapterIds))
      .orderBy(asc(questions.chapterId), asc(questions.index))
      .limit(limit);
  }

  async getQuestionsByIds(questionIds: string[]) {
    if (questionIds.length === 0) return [];
    return this.db
      .select()
      .from(questions)
      .where(inArray(questions.id, questionIds));
  }
}
