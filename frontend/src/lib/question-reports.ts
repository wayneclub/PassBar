import { api } from './api';

export type ReportCategory = 'wrong_answer' | 'typo' | 'unclear' | 'outdated' | 'explanation_incorrect' | 'other';

export const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'wrong_answer',         label: '答案有誤' },
  { value: 'typo',                 label: '題目有誤字' },
  { value: 'unclear',              label: '說明不清楚' },
  { value: 'outdated',             label: '內容已過時' },
  { value: 'explanation_incorrect', label: '解析有誤' },
  { value: 'other',                label: '其他' },
];

export type QuestionReport = {
  id: string;
  question_id: string;
  user_id: string | null;
  category: ReportCategory;
  categories: ReportCategory[] | null;
  language: string | null;
  message: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
  profiles?: { full_name: string | null; email: string | null } | null;
};

type ReportResponse = {
  id: string;
  questionId: string;
  userId: string | null;
  category: string;
  categories: string[] | null;
  language: string | null;
  message: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  fullName?: string | null;
  email?: string | null;
};

function toReport(r: ReportResponse): QuestionReport {
  return {
    id: r.id,
    question_id: r.questionId,
    user_id: r.userId,
    category: r.category as ReportCategory,
    categories: r.categories as ReportCategory[] | null,
    language: r.language,
    message: r.message,
    resolved: r.resolved,
    resolved_at: r.resolvedAt,
    created_at: r.createdAt,
    profiles: { full_name: r.fullName ?? null, email: r.email ?? null },
  };
}

export async function submitQuestionReport(input: {
  questionId: string;
  userId: string;
  categories: ReportCategory[];
  language: string;
  message?: string;
}): Promise<boolean> {
  try {
    await api.post('/question-reports', {
      questionId: input.questionId,
      categories: input.categories,
      language: input.language,
      message: input.message?.trim() || undefined,
    });
    return true;
  } catch (err) {
    console.warn('submitQuestionReport:', err);
    return false;
  }
}

export async function getQuestionReports(options?: {
  resolved?: boolean;
  limit?: number;
}): Promise<QuestionReport[]> {
  try {
    const params = new URLSearchParams();
    if (options?.resolved !== undefined) params.set('resolved', String(options.resolved));
    params.set('limit', String(options?.limit ?? 50));
    const rows = await api.get<ReportResponse[]>(`/question-reports?${params.toString()}`);
    return rows.map(toReport);
  } catch (err) {
    console.warn('getQuestionReports:', err);
    return [];
  }
}

export async function resolveQuestionReport(reportId: string): Promise<boolean> {
  try {
    await api.patch(`/question-reports/${reportId}/resolve`);
    return true;
  } catch (err) {
    console.warn('resolveQuestionReport:', err);
    return false;
  }
}
