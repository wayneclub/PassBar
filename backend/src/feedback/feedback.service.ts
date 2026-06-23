import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { feedback, profiles } from '../db/schema';

@Injectable()
export class FeedbackService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async submit(input: {
    userId: string | null;
    category?: string;
    subject?: string;
    qid?: string;
    refSubject?: string;
    refChapter?: string;
    email?: string;
    message: string;
  }) {
    const [created] = await this.db.insert(feedback).values(input).returning({ id: feedback.id });
    return Boolean(created);
  }

  async list(options: { categories: string[]; resolved?: boolean; limit?: number }) {
    return this.db
      .select({
        id: feedback.id,
        userId: feedback.userId,
        category: feedback.category,
        subject: feedback.subject,
        qid: feedback.qid,
        refSubject: feedback.refSubject,
        refChapter: feedback.refChapter,
        email: feedback.email,
        message: feedback.message,
        resolved: feedback.resolved,
        resolvedAt: feedback.resolvedAt,
        createdAt: feedback.createdAt,
        fullName: profiles.fullName,
        profileEmail: profiles.email,
      })
      .from(feedback)
      .leftJoin(profiles, eq(profiles.id, feedback.userId))
      .where(
        and(
          inArray(feedback.category, options.categories),
          options.resolved !== undefined ? eq(feedback.resolved, options.resolved) : undefined,
        ),
      )
      .orderBy(desc(feedback.createdAt))
      .limit(options.limit ?? 100);
  }

  async resolve(feedbackId: string) {
    const [updated] = await this.db
      .update(feedback)
      .set({ resolved: true, resolvedAt: new Date() })
      .where(eq(feedback.id, feedbackId))
      .returning({ id: feedback.id });
    return Boolean(updated);
  }
}
