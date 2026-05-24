import { MBE_SUBJECTS, MOCK_QUESTIONS } from './mock-data';
import { supabase } from './supabase';
import { Question, Subject } from './types';

type QuestionRow = {
  id: string;
  subject: string;
  chapter_id: string;
  topic: string;
  question_text: string;
  options: string[];
  correct_answer: string;
  api_match_ok: boolean | null;
  explain_imgs: string[] | null;
  source_explanation_image_file: string | null;
  source_explanation_image_url: string | null;
  explanation_html: string | null;
};

type ChapterSummaryRow = {
  subject: string;
  chapter_id: string;
  topic: string;
  count: number;
};

function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    subject: row.subject,
    topic: row.topic,
    questionText: row.question_text,
    options: row.options,
    correctAnswer: row.correct_answer,
    apiMatchOk: row.api_match_ok ?? true,
    explainImgs: row.explain_imgs ?? [],
    sourceExplanationImageFile: row.source_explanation_image_file ?? undefined,
    sourceExplanationImageUrl: row.source_explanation_image_url ?? undefined,
    explanationHtml: row.explanation_html ?? undefined,
  };
}

function getMockChapterId(questionId: string) {
  const parts = questionId.split('-');
  return `${parts[0]}-${parts[1]}`;
}

export async function getSubjects(): Promise<Subject[]> {
  if (!supabase) return MBE_SUBJECTS;

  const { data, error } = await supabase
    .from('question_chapter_counts')
    .select('subject, chapter_id, topic, count')
    .order('subject', { ascending: true })
    .order('topic', { ascending: true });

  if (error || !data) {
    console.warn('[PassBar] Falling back to local question metadata:', error?.message);
    return MBE_SUBJECTS;
  }

  const grouped = new Map<string, Subject>();
  (data as ChapterSummaryRow[]).forEach((row) => {
    const existing = grouped.get(row.subject) ?? {
      id: row.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name: row.subject,
      count: 0,
      chapters: [],
    };

    existing.count += row.count;
    existing.chapters.push({
      id: row.chapter_id,
      name: row.topic,
      count: row.count,
    });
    grouped.set(row.subject, existing);
  });

  return Array.from(grouped.values());
}

export async function getQuestionsByChapterIds(chapterIds: string[], limit: number): Promise<Question[]> {
  if (!supabase) {
    return MOCK_QUESTIONS
      .filter((question) => chapterIds.includes(getMockChapterId(question.id)))
      .slice(0, limit);
  }

  const { data, error } = await supabase
    .from('questions')
    .select('id, subject, chapter_id, topic, question_text, options, correct_answer, api_match_ok, explain_imgs, source_explanation_image_file, source_explanation_image_url, explanation_html')
    .in('chapter_id', chapterIds)
    .limit(limit);

  if (error || !data) {
    console.warn('[PassBar] Falling back to local questions:', error?.message);
    return MOCK_QUESTIONS
      .filter((question) => chapterIds.includes(getMockChapterId(question.id)))
      .slice(0, limit);
  }

  return (data as QuestionRow[]).map(toQuestion);
}

export async function getQuestionsByIds(questionIds: string[]): Promise<Question[]> {
  if (!supabase) {
    return questionIds
      .map((questionId) => MOCK_QUESTIONS.find((question) => question.id === questionId))
      .filter((question): question is Question => Boolean(question));
  }

  const { data, error } = await supabase
    .from('questions')
    .select('id, subject, chapter_id, topic, question_text, options, correct_answer, api_match_ok, explain_imgs, source_explanation_image_file, source_explanation_image_url, explanation_html')
    .in('id', questionIds);

  if (error || !data) {
    console.warn('[PassBar] Falling back to local session questions:', error?.message);
    return questionIds
      .map((questionId) => MOCK_QUESTIONS.find((question) => question.id === questionId))
      .filter((question): question is Question => Boolean(question));
  }

  const byId = new Map((data as QuestionRow[]).map((row) => [row.id, toQuestion(row)]));
  return questionIds
    .map((questionId) => byId.get(questionId))
    .filter((question): question is Question => Boolean(question));
}
