import { supabase } from './supabase';

export type ReportCategory = 'wrong_answer' | 'typo' | 'unclear' | 'outdated' | 'other';

export const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'wrong_answer', label: '答案有誤' },
  { value: 'typo',         label: '題目有誤字' },
  { value: 'unclear',      label: '說明不清楚' },
  { value: 'outdated',     label: '內容已過時' },
  { value: 'other',        label: '其他' },
];

export type QuestionReport = {
  id: string;
  question_id: string;
  user_id: string | null;
  category: ReportCategory;
  message: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
  profiles?: { full_name: string | null; email: string | null } | null;
};

export async function submitQuestionReport(input: {
  questionId: string;
  userId: string;
  category: ReportCategory;
  message?: string;
}): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('question_reports').insert({
    question_id: input.questionId,
    user_id: input.userId,
    category: input.category,
    message: input.message?.trim() || null,
  });
  if (error && !error.message.includes('201')) { console.warn('submitQuestionReport:', error.message); return false; }
  return true;
}

export async function getQuestionReports(options?: {
  resolved?: boolean;
  limit?: number;
}): Promise<QuestionReport[]> {
  if (!supabase) return [];
  let query = supabase
    .from('question_reports')
    .select('*, profiles(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 50);

  if (options?.resolved !== undefined) {
    query = query.eq('resolved', options.resolved);
  }

  const { data, error } = await query;
  if (error) { console.warn('getQuestionReports:', error.message); return []; }
  return (data ?? []) as QuestionReport[];
}

export async function resolveQuestionReport(reportId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from('question_reports')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) { console.warn('resolveQuestionReport:', error.message); return false; }
  return true;
}
