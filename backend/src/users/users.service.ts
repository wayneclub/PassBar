import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { profiles } from '../db/schema';

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async getProfile(userId: string) {
    return this.db.query.profiles.findFirst({ where: eq(profiles.id, userId) });
  }

  async saveStudySettings(userId: string, studySettings: Record<string, unknown>) {
    const [updated] = await this.db
      .update(profiles)
      .set({ studySettings, updatedAt: new Date() })
      .where(eq(profiles.id, userId))
      .returning({ id: profiles.id });
    return Boolean(updated);
  }

  async updateExamDate(userId: string, examDate: string | null) {
    const [updated] = await this.db
      .update(profiles)
      .set({ examDate, updatedAt: new Date() })
      .where(eq(profiles.id, userId))
      .returning({ id: profiles.id });
    return Boolean(updated);
  }

  async updateDisplayName(userId: string, fullName: string) {
    const [updated] = await this.db
      .update(profiles)
      .set({ fullName, updatedAt: new Date() })
      .where(eq(profiles.id, userId))
      .returning({ id: profiles.id });
    return Boolean(updated);
  }

}
