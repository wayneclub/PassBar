import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { pushSubscriptions } from '../db/schema';

@Injectable()
export class PushService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async saveSubscription(input: { userId: string; endpoint: string; p256dh: string; auth: string; userAgent?: string | null }) {
    await this.db
      .insert(pushSubscriptions)
      .values({
        userId: input.userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.endpoint],
        set: { p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent ?? null, userId: input.userId },
      });
    return true;
  }

  async deleteSubscription(endpoint: string) {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    return true;
  }
}
