import { supabase } from './supabase';

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

export async function getFeedback(options: {
  categories: FeedbackCategory[];
  resolved?: boolean;
  limit?: number;
}): Promise<Feedback[]> {
  if (!supabase) return [];
  let query = supabase
    .from('feedback')
    .select('*, profiles(full_name, email)')
    .in('category', options.categories)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 100);

  if (options.resolved !== undefined) {
    query = query.eq('resolved', options.resolved);
  }

  const { data, error } = await query;
  if (error) { console.warn('getFeedback:', error.message); return []; }
  return (data ?? []) as Feedback[];
}

export async function resolveFeedback(feedbackId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from('feedback')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', feedbackId)
    .select('id');
  if (error) { console.warn('resolveFeedback:', error.message); return false; }
  return true;
}
