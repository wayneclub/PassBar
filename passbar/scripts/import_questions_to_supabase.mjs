import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

dotenv.config({ path: '.env.local', override: false });
dotenv.config({ path: '.env', override: false });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.env.DRY_RUN === 'true';

// --subject / --chapter filtering (supports multi-word values without quotes)
function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const parts = [];
  for (let i = idx + 1; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) break;
    parts.push(process.argv[i]);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}
const filterSubject = getArg('--subject');
const filterChapter = getArg('--chapter');

if (!dryRun && (!supabaseUrl || !serviceRoleKey)) {
  const missing = [
    supabaseUrl ? null : 'SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL',
    serviceRoleKey ? null : 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);
  console.error(`Missing required env: ${missing.join(', ')}.`);
  console.error('The importer reads passbar/.env.local first, then passbar/.env.');
  process.exit(1);
}

const projectRoot = path.resolve(process.cwd(), '..');
const outDir = process.env.QUESTIONS_OUT_DIR
  ? path.resolve(process.env.QUESTIONS_OUT_DIR)
  : process.env.OUT_DIR
    ? path.resolve(process.env.OUT_DIR)
    : path.join(projectRoot, 'out');
const supabase = dryRun ? null : createClient(supabaseUrl, serviceRoleKey);

const choiceOrder = ['A', 'B', 'C', 'D'];
function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeChoiceKey(value) {
  const key = String(value ?? '').trim().toUpperCase();
  return choiceOrder.includes(key) ? key : null;
}

function subjectId(meta) {
  return slugify(meta.subject);
}

function chapterId(meta) {
  return `${subjectId(meta)}-${slugify(meta.chapter)}`;
}

function isErrorHtml(html) {
  return !html || String(html).trimStart().startsWith('<!-- ERROR:');
}

function questionAnalysisMeta(item) {
  const nested = item?.meta && typeof item.meta === 'object'
    ? item.meta.question_analysis
    : null;
  const legacy = item?.question_analysis_meta
    ?? (item?.question_highlight_meta ? {
      micro_concept: item.micro_concept,
      trap_type: item.trap_type,
      skill_tested: item.skill_tested,
      question_highlight_meta: item.question_highlight_meta,
    } : null);
  const meta = nested && typeof nested === 'object' ? nested : legacy;
  return {
    micro_concept: typeof meta?.micro_concept === 'string' && meta.micro_concept.trim()
      ? meta.micro_concept.trim()
      : null,
    trap_type: typeof meta?.trap_type === 'string' && meta.trap_type.trim()
      ? meta.trap_type.trim()
      : null,
    trap_type_is_new: typeof meta?.trap_type_is_new === 'boolean'
      ? meta.trap_type_is_new
      : null,
    skill_tested: typeof meta?.skill_tested === 'string' && meta.skill_tested.trim()
      ? meta.skill_tested.trim()
      : null,
    keyword_meta: (meta?.question_keyword_meta || meta?.choice_keyword_meta)
      ? {
          question_keyword_meta: meta.question_keyword_meta ?? null,
          choice_keyword_meta:   meta.choice_keyword_meta   ?? null,
        }
      : null,
    highlight_meta: meta?.question_highlight_meta
      ? { question_highlight_meta: meta.question_highlight_meta }
      : null,
  };
}

async function listEnrichedFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listEnrichedFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith('_enriched.json')) return [fullPath];
    return [];
  }));
  return files.flat().sort();
}

function parseEnrichedDocument(raw) {
  if (Array.isArray(raw)) {
    const firstItem = raw[0] ?? {};
    return {
      meta: {
        subject: firstItem.subject ?? '',
        chapter: firstItem.chapter ?? '',
        count: firstItem.count ?? raw.length,
      },
      items: raw,
    };
  }
  const items = Array.isArray(raw?.questions) ? raw.questions : [];
  const firstItem = items[0] ?? {};
  return {
    meta: {
      subject: raw?.meta?.subject ?? firstItem.subject ?? '',
      chapter: raw?.meta?.chapter ?? firstItem.chapter ?? '',
      count: raw?.meta?.count ?? firstItem.count ?? items.length,
    },
    items,
  };
}

function enrichedQuality(items) {
  let score = 0;
  for (const item of items) {
    if (String(item['zh-question'] ?? '').trim()) score += 1;
    if (item['zh-choices'] && Object.keys(item['zh-choices']).length > 0) score += 1;
    if (!isErrorHtml(item['zh-explanation'])) score += 1;
    if (!isErrorHtml(item.explanation)) score += 1;
  }
  return score;
}

async function selectCanonicalFiles(files) {
  const bestByChapter = new Map();

  for (const file of files) {
    const { meta, items } = parseEnrichedDocument(JSON.parse(await readFile(file, 'utf8')));
    if (items.length === 0) continue;

    const expectedCount = Number.isFinite(meta.count) ? meta.count : items.length;
    const candidate = {
      file,
      count: items.length,
      completeness: expectedCount > 0 ? items.length / expectedCount : 1,
      quality: enrichedQuality(items),
    };
    const key = chapterId(meta);
    const current = bestByChapter.get(key);

    if (
      !current ||
      candidate.completeness > current.completeness ||
      (candidate.completeness === current.completeness && candidate.count > current.count) ||
      (candidate.completeness === current.completeness && candidate.count === current.count && candidate.quality > current.quality) ||
      (candidate.completeness === current.completeness && candidate.count === current.count && candidate.quality === current.quality && candidate.file > current.file)
    ) {
      bestByChapter.set(key, candidate);
    }
  }

  return [...bestByChapter.values()].map((c) => c.file).sort();
}

async function fetchQuestionIdsByIndex(chapId, items) {
  if (dryRun) {
    return new Map(items.map((item) => [
      item.index,
      `${chapId}-${String(item.index).padStart(4, '0')}`,
    ]));
  }
  const { data, error } = await supabase
    .from('question_items')
    .select('id, index')
    .eq('chapter_id', chapId);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.index, row.id]));
}

async function upsert(table, rows, onConflict) {
  if (dryRun || rows.length === 0) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────

let allFiles = await listEnrichedFiles(outDir);
if (allFiles.length === 0) {
  console.error(`No *_enriched.json files found in ${outDir}`);
  process.exit(1);
}

// Apply --subject / --chapter filter before canonical selection
if (filterSubject || filterChapter) {
  const subjectPart = filterSubject ? filterSubject.toLowerCase() : null;
  const chapterPart = filterChapter ? filterChapter.toLowerCase() : null;
  allFiles = allFiles.filter((f) => {
    const rel = path.relative(outDir, f).toLowerCase();
    if (subjectPart && !rel.includes(subjectPart)) return false;
    if (chapterPart && !rel.includes(chapterPart)) return false;
    return true;
  });
  if (allFiles.length === 0) {
    console.error(`No enriched files matched --subject "${filterSubject}" --chapter "${filterChapter}"`);
    process.exit(1);
  }
  console.log(`Filter: subject="${filterSubject ?? '*'}" chapter="${filterChapter ?? '*'}" → ${allFiles.length} file(s)`);
}

const files = await selectCanonicalFiles(allFiles);
if (allFiles.length !== files.length) {
  console.log(`Using ${files.length} canonical enriched files (skipped ${allFiles.length - files.length} duplicate chapter files).`);
}
console.log(`Importing from ${files.length} enriched file(s) in ${outDir}`);
console.log('Image upload: disabled (HTML explanations are canonical)');
console.log('─'.repeat(60));

let totalQuestions = 0;
let totalTexts = 0;
let totalChoices = 0;
let totalExplanations = 0;

for (const file of files) {
  const { meta, items } = parseEnrichedDocument(JSON.parse(await readFile(file, 'utf8')));
  if (items.length === 0) continue;

  const relativeFile = path.relative(outDir, file);
  const chapId = chapterId(meta);
  console.log(`[${files.indexOf(file) + 1}/${files.length}] ${relativeFile}: ${items.length} questions`);

  let idByIndex;
  try {
    idByIndex = await fetchQuestionIdsByIndex(chapId, items);
  } catch (err) {
    console.error(`  WARN: cannot fetch question IDs for ${chapId}: ${err.message} — skipping`);
    continue;
  }

  const subject = {
    id: subjectId(meta),
    subject: meta.subject,
    slug: subjectId(meta),
  };

  const chapter = {
    id: chapId,
    subject_id: subjectId(meta),
    subject: meta.subject,
    chapter: meta.chapter,
    slug: slugify(meta.chapter),
    count: Number.isFinite(meta.count) ? meta.count : items.length,
    source: null,
    captured_at: null,
    screenshot_count: null,
    url: null,
    exam_name: null,
    raw_meta: null,
  };

  const questionItems = [];
  const texts = [];
  const choices = [];
  const explanations = [];
  const allQuestionIds = [];

  for (const item of items) {
    const answer = normalizeChoiceKey(item.answer);
    if (!answer) {
      console.warn(`  ⚠ Skipping #${item.index}: invalid answer "${item.answer}"`);
      continue;
    }

    const questionId = idByIndex.get(item.index) ?? `${chapId}-${String(item.index).padStart(4, '0')}`;
    const analysisMeta = questionAnalysisMeta(item);
    allQuestionIds.push(questionId);

    questionItems.push({
      id: questionId,
      chapter_id: chapId,
      index: item.index,
      question: item.question,
      correct_answer: answer,
      source_question: item.question,
      source_choices: item.choices ?? null,
      source_correct_answer: answer,
      source_explanation_html: isErrorHtml(item.explanation) ? null : item.explanation,
      topic:            typeof item.topic === 'string' && item.topic.trim() ? item.topic.trim() : null,
      micro_concept:    analysisMeta.micro_concept,
      trap_type:        analysisMeta.trap_type,
      trap_type_is_new: analysisMeta.trap_type_is_new,
      skill_tested:     analysisMeta.skill_tested,
      keyword_meta:     analysisMeta.keyword_meta,
      highlight_meta:   analysisMeta.highlight_meta,
      raw: item,
      updated_at: new Date().toISOString(),
    });

    const enQuestion = String(item.question ?? '').trim();
    const zhQuestion = String(item['zh-question'] ?? '').trim();
    if (enQuestion) texts.push({ question_id: questionId, language: 'en', source: 'enriched', question_stem: enQuestion, raw: null });
    if (zhQuestion) texts.push({ question_id: questionId, language: 'zh', source: 'enriched', question_stem: zhQuestion, raw: null });

    choiceOrder.forEach((key, sortOrder) => {
      const enText = item.choices?.[key] ?? item.choices?.[key.toLowerCase()] ?? '';
      if (enText) {
        choices.push({ question_id: questionId, language: 'en', source: 'enriched', choice_key: key.toLowerCase(), choice: enText, sort_order: sortOrder, is_correct: key === answer, raw: null });
      }
      const zhText = item['zh-choices']?.[key] ?? item['zh-choices']?.[key.toLowerCase()] ?? '';
      if (zhText) {
        choices.push({ question_id: questionId, language: 'zh', source: 'enriched', choice_key: key.toLowerCase(), choice: zhText, sort_order: sortOrder, is_correct: key === answer, raw: null });
      }
    });

    if (!isErrorHtml(item.explanation)) {
      const enExp = {
        question_id: questionId,
        language: 'en',
        source: 'enriched',
        explanation_text: null,
        explanation_html: item.explanation,
        mime_type: 'text/html',
        sort_order: 0,
        raw: null,
      };

      explanations.push(enExp);
    }

    if (!isErrorHtml(item['zh-explanation'])) {
      explanations.push({
        question_id: questionId,
        language: 'zh',
        source: 'enriched',
        explanation_text: null,
        explanation_html: item['zh-explanation'],
        mime_type: 'text/html',
        sort_order: 0,
        raw: null,
      });
    }
  }

  try {
    await upsert('subjects', [subject], 'id');
    await upsert('chapters', [chapter], 'id');
    await upsert('question_items', questionItems, 'id');

    // Delete stale child rows before re-inserting so there are no orphan records
    if (!dryRun && allQuestionIds.length > 0) {
      const { error: e1 } = await supabase.from('question_texts').delete().in('question_id', allQuestionIds);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('question_choices').delete().in('question_id', allQuestionIds);
      if (e2) throw e2;
      const { error: e3 } = await supabase.from('question_explanations').delete().in('question_id', allQuestionIds);
      if (e3) throw e3;
    }

    await upsert('question_texts',        texts,        'question_id,language,source');
    await upsert('question_choices',      choices,      'question_id,language,choice_key');
    await upsert('question_explanations', explanations, 'question_id,language,source,sort_order');
  } catch (err) {
    console.error(`  Failed importing ${relativeFile}:`, err.message);
    process.exit(1);
  }

  totalQuestions    += questionItems.length;
  totalTexts        += texts.length;
  totalChoices      += choices.length;
  totalExplanations += explanations.length;
  const tag = dryRun ? '[dry-run] ' : '';
  console.log(`  ↳ ${tag}questions:${questionItems.length}  texts:${texts.length}  choices:${choices.length}  explanations:${explanations.length}`);
}

const verb = dryRun ? 'Validated' : 'Imported';
console.log('─'.repeat(60));
console.log(`${verb} ${totalQuestions} questions, ${totalTexts} texts, ${totalChoices} choices, ${totalExplanations} explanations from ${files.length} files.`);
