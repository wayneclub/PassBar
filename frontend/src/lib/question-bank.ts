import { api } from './api';
import { MBE_SUBJECTS, MOCK_QUESTIONS } from './mock-data';
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
  chapterId: string;
  chapterName: string;
  questionText: string;
  fetchedQuestionStem: string | null;
  zhQuestionStem: string | null;
  options: string[];
  bilingualOptions: string[];
  zhOptions: string[];
  correctAnswer: string;
  correctAnswerLetter: string;
  apiAnswerKey: string | null;
  apiMatchOk: boolean | null;
  enExplanationHtml: string | null;  // gemini-generated English interactive HTML
  explanationHtml: string | null;    // zh explanation html
  topic: string | null;              // fine-grained topic from source image
  microConcept: string | null;
  trapType: string | null;
  skillTested: string | null;
  keywordMeta: unknown;
  highlightMeta: unknown;
  raw: unknown;
};

type ChapterSummaryRow = {
  subject: string;
  chapterId: string;
  chapterName: string;
  count: number;
};

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
    chapterName: row.chapterName,
    chapterId: row.chapterId,
    questionText: row.questionText,
    bilingualQuestionText: row.fetchedQuestionStem ?? undefined,
    zhQuestionText: row.zhQuestionStem ?? undefined,
    options: row.options,
    bilingualOptions: row.bilingualOptions ?? undefined,
    zhOptions: row.zhOptions?.length ? row.zhOptions : undefined,
    correctAnswer: row.correctAnswer,
    correctAnswerLetter: row.correctAnswerLetter,
    apiAnswerKey: row.apiAnswerKey ?? undefined,
    apiMatchOk: row.apiMatchOk ?? true,
    enExplanationHtml: row.enExplanationHtml ?? undefined,
    explanationHtml: row.explanationHtml ?? undefined,
    topic: typeof row.topic === 'string' && row.topic.trim() ? row.topic.trim() : undefined,
    microConcept: typeof row.microConcept === 'string' && row.microConcept.trim() ? row.microConcept.trim() : undefined,
    trapType: typeof row.trapType === 'string' && row.trapType.trim() ? row.trapType.trim() : undefined,
    skillTested: typeof row.skillTested === 'string' && row.skillTested.trim() ? row.skillTested.trim() : undefined,
    questionHighlightMeta: parseQuestionHighlightMeta(row.highlightMeta ?? row.raw),
    questionKeywordMeta: parseQuestionKeywordMeta(row.keywordMeta ?? row.raw),
    choiceKeywordMeta: parseChoiceKeywordMeta(row.keywordMeta ?? row.raw),
  };
}

function getMockChapterId(questionId: string) {
  const parts = questionId.split('-');
  return `${parts[0]}-${parts[1]}`;
}

export async function getSubjects(): Promise<Subject[]> {
  try {
    const rows = await api.get<ChapterSummaryRow[]>('/questions/subjects');

    const grouped = new Map<string, Subject>();
    rows.forEach((row) => {
      const existing = grouped.get(row.subject) ?? {
        id: row.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name: row.subject,
        count: 0,
        chapters: [],
      };

      existing.count += row.count;
      existing.chapters.push({
        id: row.chapterId,
        name: row.chapterName,
        count: row.count,
      });
      grouped.set(row.subject, existing);
    });

    return Array.from(grouped.values()).filter((s) => s.count > 0);
  } catch (err) {
    console.warn('[PassBar] Falling back to local question metadata:', err);
    return MBE_SUBJECTS;
  }
}

export async function getQuestionIdsByChapterIds(chapterIds: string[]): Promise<string[]> {
  try {
    return await api.get<string[]>(`/questions/ids?chapterIds=${encodeURIComponent(chapterIds.join(','))}`);
  } catch (err) {
    console.warn('[PassBar] Falling back to local question ids:', err);
    return MOCK_QUESTIONS
      .filter((q) => chapterIds.includes(getMockChapterId(q.id)))
      .map((q) => q.id);
  }
}

/** Returns a map of chapter_id → question IDs for all questions. */
export async function getAllQuestionIdsByChapter(): Promise<Record<string, string[]>> {
  try {
    return await api.get<Record<string, string[]>>('/questions/ids-by-chapter');
  } catch (err) {
    console.warn('[PassBar] Falling back to local question ids by chapter:', err);
    const map: Record<string, string[]> = {};
    for (const q of MOCK_QUESTIONS) {
      const cid = getMockChapterId(q.id);
      (map[cid] ??= []).push(q.id);
    }
    return map;
  }
}

export async function getQuestionsByChapterIds(chapterIds: string[], limit: number): Promise<Question[]> {
  try {
    const rows = await api.get<QuestionRow[]>(
      `/questions?chapterIds=${encodeURIComponent(chapterIds.join(','))}&limit=${limit}`,
    );
    return rows.map(toQuestion);
  } catch (err) {
    console.warn('[PassBar] Falling back to local questions:', err);
    return MOCK_QUESTIONS
      .filter((question) => chapterIds.includes(getMockChapterId(question.id)))
      .slice(0, limit);
  }
}

export async function getQuestionsByIds(questionIds: string[]): Promise<Question[]> {
  try {
    const rows = await api.get<QuestionRow[]>(`/questions/by-ids?ids=${encodeURIComponent(questionIds.join(','))}`);
    const byId = new Map(rows.map((row) => [row.id, toQuestion(row)]));
    return questionIds
      .map((questionId) => byId.get(questionId))
      .filter((question): question is Question => Boolean(question));
  } catch (err) {
    console.warn('[PassBar] Falling back to local session questions:', err);
    return questionIds
      .map((questionId) => MOCK_QUESTIONS.find((question) => question.id === questionId))
      .filter((question): question is Question => Boolean(question));
  }
}
