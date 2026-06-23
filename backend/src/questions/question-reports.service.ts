import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { questionReports, profiles } from '../db/schema';

@Injectable()
export class QuestionReportsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async submit(input: {
    questionId: string;
    userId: string;
    categories: string[];
    language: string;
    message?: string;
  }) {
    await this.db.insert(questionReports).values({
      questionId: input.questionId,
      userId: input.userId,
      category: input.categories[0] ?? 'other',
      categories: input.categories,
      language: input.language,
      message: input.message?.trim() || null,
    });
    return true;
  }

  async list(options?: { resolved?: boolean; limit?: number }) {
    const rows = await this.db
      .select({
        id: questionReports.id,
        questionId: questionReports.questionId,
        userId: questionReports.userId,
        category: questionReports.category,
        categories: questionReports.categories,
        language: questionReports.language,
        message: questionReports.message,
        resolved: questionReports.resolved,
        resolvedAt: questionReports.resolvedAt,
        createdAt: questionReports.createdAt,
        fullName: profiles.fullName,
        email: profiles.email,
      })
      .from(questionReports)
      .leftJoin(profiles, eq(profiles.id, questionReports.userId))
      .where(
        options?.resolved !== undefined
          ? eq(questionReports.resolved, options.resolved)
          : undefined,
      )
      .orderBy(desc(questionReports.createdAt))
      .limit(options?.limit ?? 50);
    return rows;
  }

  async resolve(reportId: string) {
    const [updated] = await this.db
      .update(questionReports)
      .set({ resolved: true, resolvedAt: new Date() })
      .where(eq(questionReports.id, reportId))
      .returning({ id: questionReports.id });
    return Boolean(updated);
  }
}
