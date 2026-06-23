import { api } from './api';

export type FeedbackCategory = 'content' | 'bug' | 'feature' | 'account' | 'other';

export type Feedback = {
  id: string;
  user_id: string | null;
  category: FeedbackCategory | string;
  subject: string | null;
  qid: string | null;
  ref_subject: string | null;
  ref_chapter: string | null;
  email: string | null;
  message: string;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
  profiles?: { full_name: string | null; email: string | null } | null;
};

type FeedbackResponse = {
  id: string;
  userId: string | null;
  category: string | null;
  subject: string | null;
  qid: string | null;
  refSubject: string | null;
  refChapter: string | null;
  email: string | null;
  message: string;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  fullName?: string | null;
  profileEmail?: string | null;
};

function toFeedback(r: FeedbackResponse): Feedback {
  return {
    id: r.id,
    user_id: r.userId,
    category: r.category ?? 'other',
    subject: r.subject,
    qid: r.qid,
    ref_subject: r.refSubject,
    ref_chapter: r.refChapter,
    email: r.email,
    message: r.message,
    resolved: r.resolved,
    resolved_at: r.resolvedAt,
    created_at: r.createdAt,
    profiles: { full_name: r.fullName ?? null, email: r.profileEmail ?? null },
  };
}

export async function submitFeedback(input: {
  userId?: string | null;
  category?: FeedbackCategory;
  subject?: string;
  qid?: string;
  refSubject?: string;
  refChapter?: string;
  email?: string;
  message: string;
}): Promise<boolean> {
  try {
    await api.post('/feedback', {
      category: input.category,
      subject: input.subject,
      qid: input.qid,
      refSubject: input.refSubject,
      refChapter: input.refChapter,
      email: input.email,
      message: input.message,
    });
    return true;
  } catch (err) {
    console.warn('submitFeedback:', err);
    return false;
  }
}

export async function getFeedback(options: {
  categories: FeedbackCategory[];
  resolved?: boolean;
  limit?: number;
}): Promise<Feedback[]> {
  try {
    const params = new URLSearchParams();
    params.set('categories', options.categories.join(','));
    if (options.resolved !== undefined) params.set('resolved', String(options.resolved));
    params.set('limit', String(options.limit ?? 100));
    const rows = await api.get<FeedbackResponse[]>(`/feedback?${params.toString()}`);
    return rows.map(toFeedback);
  } catch (err) {
    console.warn('getFeedback:', err);
    return [];
  }
}

export async function resolveFeedback(feedbackId: string): Promise<boolean> {
  try {
    await api.patch(`/feedback/${feedbackId}/resolve`);
    return true;
  } catch (err) {
    console.warn('resolveFeedback:', err);
    return false;
  }
}
