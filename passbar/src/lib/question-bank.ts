import { MBE_SUBJECTS, MOCK_QUESTIONS } from './mock-data';
import { supabase } from './supabase';
import { ExplanationOcr, Question, Subject } from './types';

type QuestionRow = {
  id: string;
  subject: string;
  chapter_id: string;
  topic: string;
  question_text: string;
  fetched_question_stem: string | null;
  options: string[];
  bilingual_options: string[];
  correct_answer: string;
  correct_answer_letter: string;
  api_answer_key: string | null;
  api_match_ok: boolean | null;
  explain_imgs: string[] | null;
  zh_explain_imgs: string[] | null;
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

type ExplanationImageRow = {
  question_id: string;
  public_url: string | null;
};

type ExplanationOcrRow = {
  question_id: string;
  public_url: string;
  text: string | null;
  words: ExplanationOcr['words'];
};

const questionSelectFields = 'id, subject, chapter_id, topic, question_text, fetched_question_stem, options, bilingual_options, correct_answer, correct_answer_letter, api_answer_key, api_match_ok, explain_imgs, source_explanation_image_file, source_explanation_image_url, explanation_html';

function toQuestion(row: QuestionRow, ocrByQuestion = new Map<string, ExplanationOcr[]>()) : Question {
  return {
    id: row.id,
    subject: row.subject,
    topic: row.topic,
    questionText: row.question_text,
    bilingualQuestionText: row.fetched_question_stem ?? undefined,
    options: row.options,
    bilingualOptions: row.bilingual_options ?? undefined,
    correctAnswer: row.correct_answer,
    correctAnswerLetter: row.correct_answer_letter,
    apiAnswerKey: row.api_answer_key ?? undefined,
    apiMatchOk: row.api_match_ok ?? true,
    explainImgs: row.explain_imgs ?? [],
    zhExplainImgs: row.zh_explain_imgs ?? [],
    sourceExplanationImageFile: row.source_explanation_image_file ?? undefined,
    sourceExplanationImageUrl: row.source_explanation_image_url ?? undefined,
    explanationHtml: row.explanation_html ?? undefined,
    explanationOcr: ocrByQuestion.get(row.id) ?? [],
  };
}

function getMockChapterId(questionId: string) {
  const parts = questionId.split('-');
  return `${parts[0]}-${parts[1]}`;
}

async function attachChineseExplanationImages(rows: QuestionRow[]): Promise<QuestionRow[]> {
  if (!supabase || rows.length === 0) return rows;

  const { data, error } = await supabase
    .from('question_explanations')
    .select('question_id, public_url')
    .in('question_id', rows.map((row) => row.id))
    .eq('language', 'zh')
    .not('public_url', 'is', null)
    .order('sort_order', { ascending: true });

  if (error || !data) {
    if (error) console.warn('[PassBar] Failed to load Chinese explanation images:', error.message);
    return rows;
  }

  const imagesByQuestion = new Map<string, string[]>();
  (data as ExplanationImageRow[]).forEach((row) => {
    if (!row.public_url) return;
    const existing = imagesByQuestion.get(row.question_id) ?? [];
    existing.push(row.public_url);
    imagesByQuestion.set(row.question_id, existing);
  });

  return rows.map((row) => ({
    ...row,
    zh_explain_imgs: imagesByQuestion.get(row.id) ?? row.zh_explain_imgs ?? [],
  }));
}

async function getExplanationOcr(rows: QuestionRow[]): Promise<Map<string, ExplanationOcr[]>> {
  const empty = new Map<string, ExplanationOcr[]>();
  if (!supabase || rows.length === 0) return empty;

  const { data, error } = await supabase
    .from('question_explanation_ocr')
    .select('question_id, public_url, text, words')
    .in('question_id', rows.map((row) => row.id));

  if (error || !data) {
    if (error && !error.message.includes('question_explanation_ocr')) {
      console.warn('[PassBar] Failed to load explanation OCR:', error.message);
    }
    return empty;
  }

  const byQuestion = new Map<string, ExplanationOcr[]>();
  (data as ExplanationOcrRow[]).forEach((row) => {
    const existing = byQuestion.get(row.question_id) ?? [];
    existing.push({
      publicUrl: row.public_url,
      text: row.text,
      words: Array.isArray(row.words) ? row.words : [],
    });
    byQuestion.set(row.question_id, existing);
  });
  return byQuestion;
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
    .select(questionSelectFields)
    .in('chapter_id', chapterIds)
    .limit(limit);

  if (error || !data) {
    console.warn('[PassBar] Falling back to local questions:', error?.message);
    return MOCK_QUESTIONS
      .filter((question) => chapterIds.includes(getMockChapterId(question.id)))
      .slice(0, limit);
  }

  const hydratedRows = await attachChineseExplanationImages(data as QuestionRow[]);
  const ocrByQuestion = await getExplanationOcr(hydratedRows);
  return hydratedRows.map((row) => toQuestion(row, ocrByQuestion));
}

export async function getQuestionsByIds(questionIds: string[]): Promise<Question[]> {
  if (!supabase) {
    return questionIds
      .map((questionId) => MOCK_QUESTIONS.find((question) => question.id === questionId))
      .filter((question): question is Question => Boolean(question));
  }

  const { data, error } = await supabase
    .from('questions')
    .select(questionSelectFields)
    .in('id', questionIds);

  if (error || !data) {
    console.warn('[PassBar] Falling back to local session questions:', error?.message);
    return questionIds
      .map((questionId) => MOCK_QUESTIONS.find((question) => question.id === questionId))
      .filter((question): question is Question => Boolean(question));
  }

  const hydratedRows = await attachChineseExplanationImages(data as QuestionRow[]);
  const ocrByQuestion = await getExplanationOcr(hydratedRows);
  const byId = new Map(hydratedRows.map((row) => [row.id, toQuestion(row, ocrByQuestion)]));
  return questionIds
    .map((questionId) => byId.get(questionId))
    .filter((question): question is Question => Boolean(question));
}
