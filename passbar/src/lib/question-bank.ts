import { MBE_SUBJECTS, MOCK_QUESTIONS } from './mock-data';
import { supabase } from './supabase';
import {
  ChoiceKeywordMeta,
  LocalizedText,
  Question,
  QuestionHighlight,
  QuestionHighlightMeta,
  QuestionKeyword,
  QuestionKeywordMeta,
  Subject,
} from './types';

type QuestionRow = {
  id: string;
  index: number;
  subject: string;
  chapter_id: string;
  chapter_name: string;
  question_text: string;
  fetched_question_stem: string | null;
  zh_question_stem: string | null;
  options: string[];
  bilingual_options: string[];
  zh_options: string[];
  correct_answer: string;
  correct_answer_letter: string;
  api_answer_key: string | null;
  api_match_ok: boolean | null;
  en_explanation_html: string | null;  // gemini-generated English interactive HTML
  explanation_html: string | null;      // zh explanation html
  topic: string | null;                 // fine-grained topic from source image
  micro_concept: string | null;
  trap_type: string | null;
  skill_tested: string | null;
  keyword_meta: unknown;
  highlight_meta: unknown;
  raw: unknown;
};

type ChapterSummaryRow = {
  subject: string;
  chapter_id: string;
  chapter_name: string;
  count: number;
};

const questionSelectFields = 'id, index, subject, chapter_id, chapter_name, topic, micro_concept, trap_type, skill_tested, question_text, fetched_question_stem, zh_question_stem, options, bilingual_options, zh_options, correct_answer, correct_answer_letter, api_answer_key, api_match_ok, en_explanation_html, explanation_html, keyword_meta, highlight_meta, raw';

const VALID_HIGHLIGHT_KINDS = new Set([
  'key_sentence',
  'keyword',
  'issue',
  'rule_trigger',
  'fact_trigger',
]);

const VALID_KEYWORD_KINDS = new Set([
  'legal_term',
  'fact_trigger',
  'procedural_posture',
  'party_role',
  'time_marker',
  'trap_phrase',
  'remedy_or_relief',
]);

function getQuestionAnalysisMeta(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rawRecord = raw as Record<string, unknown>;
  const nestedMeta = rawRecord.meta && typeof rawRecord.meta === 'object'
    ? (rawRecord.meta as Record<string, unknown>).question_analysis
    : undefined;
  return nestedMeta && typeof nestedMeta === 'object'
    ? nestedMeta as Record<string, unknown>
    : rawRecord;
}

function parseLocalizedText(raw: unknown): LocalizedText | undefined {
  if (typeof raw === 'string') {
    const text = raw.trim();
    return text || undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const parsed: Exclude<LocalizedText, string> = {};
  const en = source.en;
  const zh = source.zh;
  if (typeof en === 'string' && en.trim()) parsed.en = en.trim();
  if (typeof zh === 'string' && zh.trim()) parsed.zh = zh.trim();
  return Object.keys(parsed).length ? parsed : undefined;
}

function parseQuestionHighlightMeta(raw: unknown): QuestionHighlightMeta | undefined {
  const meta = getQuestionAnalysisMeta(raw);
  if (!meta) return undefined;
  const value = meta.question_highlight_meta ?? meta.questionHighlightMeta;
  if (!value || typeof value !== 'object') return undefined;

  const highlights = (value as { highlights?: unknown }).highlights;
  if (!Array.isArray(highlights)) return undefined;

  const parsed: QuestionHighlight[] = highlights
    .map((item): QuestionHighlight | null => {
      if (!item || typeof item !== 'object') return null;
      const source = item as Record<string, unknown>;
      const text = typeof source.text === 'string' ? source.text.trim() : '';
      const kind = typeof source.kind === 'string' && VALID_HIGHLIGHT_KINDS.has(source.kind)
        ? source.kind as QuestionHighlight['kind']
        : 'keyword';
      if (!text) return null;
      return {
        id: typeof source.id === 'string' ? source.id : undefined,
        text,
        kind,
        label: parseLocalizedText(source.label),
        reason: parseLocalizedText(source.reason),
        importance: source.importance === 'high' || source.importance === 'medium' || source.importance === 'low'
          ? source.importance
          : undefined,
        occurrence: typeof source.occurrence === 'number' ? source.occurrence : undefined,
      };
    })
    .filter((item): item is QuestionHighlight => Boolean(item));

  if (parsed.length === 0) return undefined;
  return {
    version: typeof (value as { version?: unknown }).version === 'number'
      ? (value as { version: number }).version
      : 1,
    highlights: parsed,
  };
}

function parseKeyword(item: unknown): QuestionKeyword | null {
  if (!item || typeof item !== 'object') return null;
  const source = item as Record<string, unknown>;
  const text = typeof source.text === 'string' ? source.text.trim() : '';
  if (!text) return null;
  const kind = typeof source.kind === 'string' && VALID_KEYWORD_KINDS.has(source.kind)
    ? source.kind as QuestionKeyword['kind']
    : 'legal_term';
  return {
    id: typeof source.id === 'string' ? source.id : undefined,
    text,
    label: parseLocalizedText(source.label),
    kind,
    reason: parseLocalizedText(source.reason),
    importance: source.importance === 'high' || source.importance === 'medium' || source.importance === 'low'
      ? source.importance
      : undefined,
  };
}

function parseQuestionKeywordMeta(raw: unknown): QuestionKeywordMeta | undefined {
  const meta = getQuestionAnalysisMeta(raw);
  const value = meta?.question_keyword_meta ?? meta?.questionKeywordMeta;
  if (!value || typeof value !== 'object') return undefined;
  const keywords = (value as { keywords?: unknown }).keywords;
  if (!Array.isArray(keywords)) return undefined;
  const parsed = keywords.map(parseKeyword).filter((item): item is QuestionKeyword => Boolean(item));
  return parsed.length ? { keywords: parsed } : undefined;
}

function parseChoiceKeywordMeta(raw: unknown): ChoiceKeywordMeta | undefined {
  const meta = getQuestionAnalysisMeta(raw);
  const value = meta?.choice_keyword_meta ?? meta?.choiceKeywordMeta;
  if (!value || typeof value !== 'object') return undefined;
  const choices = (value as { choices?: unknown }).choices;
  if (!choices || typeof choices !== 'object') return undefined;

  const parsed: ChoiceKeywordMeta['choices'] = {};
  (['A', 'B', 'C', 'D'] as const).forEach((choice) => {
    const source = choices as Record<string, unknown>;
    const keywords = source[choice] ?? source[choice.toLowerCase()];
    if (!Array.isArray(keywords)) return;
    const items = keywords.map(parseKeyword).filter((item): item is QuestionKeyword => Boolean(item));
    if (items.length) parsed[choice] = items;
  });
  return Object.keys(parsed).length ? { choices: parsed } : undefined;
}

function toQuestion(row: QuestionRow) : Question {
  return {
    id: row.id,
    index: row.index,
    subject: row.subject,
    chapterName: row.chapter_name,
    chapterId: row.chapter_id,
    questionText: row.question_text,
    bilingualQuestionText: row.fetched_question_stem ?? undefined,
    zhQuestionText: row.zh_question_stem ?? undefined,
    options: row.options,
    bilingualOptions: row.bilingual_options ?? undefined,
    zhOptions: row.zh_options?.length ? row.zh_options : undefined,
    correctAnswer: row.correct_answer,
    correctAnswerLetter: row.correct_answer_letter,
    apiAnswerKey: row.api_answer_key ?? undefined,
    apiMatchOk: row.api_match_ok ?? true,
    enExplanationHtml: row.en_explanation_html ?? undefined,
    explanationHtml: row.explanation_html ?? undefined,
    topic: typeof row.topic === 'string' && row.topic.trim() ? row.topic.trim() : undefined,
    microConcept: typeof row.micro_concept === 'string' && row.micro_concept.trim() ? row.micro_concept.trim() : undefined,
    trapType: typeof row.trap_type === 'string' && row.trap_type.trim() ? row.trap_type.trim() : undefined,
    skillTested: typeof row.skill_tested === 'string' && row.skill_tested.trim() ? row.skill_tested.trim() : undefined,
    questionHighlightMeta: parseQuestionHighlightMeta(row.highlight_meta ?? row.raw),
    questionKeywordMeta: parseQuestionKeywordMeta(row.keyword_meta ?? row.raw),
    choiceKeywordMeta: parseChoiceKeywordMeta(row.keyword_meta ?? row.raw),
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
    .select('subject, chapter_id, chapter_name, count')
    .order('subject', { ascending: true })
    .order('chapter_name', { ascending: true });

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
      name: row.chapter_name,
      count: row.count,
    });
    grouped.set(row.subject, existing);
  });

  return Array.from(grouped.values()).filter((s) => s.count > 0);
}

export async function getQuestionIdsByChapterIds(chapterIds: string[]): Promise<string[]> {
  if (!supabase) {
    return MOCK_QUESTIONS
      .filter((q) => chapterIds.includes(getMockChapterId(q.id)))
      .map((q) => q.id);
  }

  const PAGE = 1000;
  const allIds: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('questions')
      .select('id')
      .in('chapter_id', chapterIds)
      .range(offset, offset + PAGE - 1);

    if (error || !data || data.length === 0) break;
    allIds.push(...(data as Array<{ id: string }>).map((r) => r.id));
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return allIds;
}

/** Returns a map of chapter_id → question IDs for all questions. Lightweight (id + chapter_id only).
 *  Paginates in batches of 1000 to work around Supabase max_rows server limit. */
export async function getAllQuestionIdsByChapter(): Promise<Record<string, string[]>> {
  if (!supabase) {
    const map: Record<string, string[]> = {};
    for (const q of MOCK_QUESTIONS) {
      const cid = getMockChapterId(q.id);
      (map[cid] ??= []).push(q.id);
    }
    return map;
  }

  const PAGE = 1000;
  const map: Record<string, string[]> = {};
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('questions')
      .select('id, chapter_id')
      .range(offset, offset + PAGE - 1);

    if (error || !data || data.length === 0) break;

    for (const r of data as Array<{ id: string; chapter_id: string }>) {
      (map[r.chapter_id] ??= []).push(r.id);
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return map;
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
    .order('chapter_id', { ascending: true })
    .order('index', { ascending: true })
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
    .select(questionSelectFields)
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
