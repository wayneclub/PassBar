import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

dotenv.config({
  path: path.resolve(process.cwd(), '../.env.local'),
  override: false,
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;
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

if (!dryRun && !databaseUrl) {
  console.error('Missing required env: DATABASE_URL.');
  console.error('The importer reads root .env.local.');
  process.exit(1);
}

const projectRoot = path.resolve(process.cwd(), '..');
const outDir = process.env.QUESTIONS_OUT_DIR
  ? path.resolve(process.env.QUESTIONS_OUT_DIR)
  : process.env.OUT_DIR
    ? path.resolve(process.env.OUT_DIR)
    : path.join(projectRoot, 'out');
const pool = dryRun ? null : new Pool({ connectionString: databaseUrl });
let connection = pool;

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

function sourceRowsForQuestion(questionId, item) {
  if (!Array.isArray(item.provenance) || item.provenance.length === 0) {
    throw new Error(`Question ${questionId} is missing required provenance`);
  }

  const sourceUids = new Set();
  return item.provenance.map((entry) => {
    const sourceUid = String(entry?.source_uid ?? '').trim();
    const provider = String(entry?.provider ?? '').trim();
    const sourceType = String(entry?.source_type ?? '').trim();
    if (!sourceUid || !provider || !sourceType || sourceUids.has(sourceUid)) {
      throw new Error(`Question ${questionId} has invalid or duplicate provenance`);
    }
    sourceUids.add(sourceUid);
    const rawNumber = entry?.source_question_number ?? entry?.source_question_index;
    const sourceQuestionNumber = Number.isInteger(Number(rawNumber))
      ? Number(rawNumber)
      : null;
    return {
      question_id: questionId,
      source_uid: sourceUid,
      provider,
      source_type: sourceType,
      source_file: typeof entry?.source_file === 'string' ? entry.source_file : null,
      source_format: typeof entry?.format === 'string' ? entry.format : null,
      source_question_number: sourceQuestionNumber,
      source_sha256: typeof entry?.source_sha256 === 'string' ? entry.source_sha256 : null,
      answer_key: typeof entry?.answer_key === 'string' ? entry.answer_key : null,
      is_ncbe: provider === 'ncbe',
    };
  });
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
  const { rows } = await connection.query(
    'SELECT id, "index" FROM public.question_items WHERE chapter_id = $1',
    [chapId],
  );
  return new Map(rows.map((row) => [row.index, row.id]));
}

function stableOfficialQuestionId(questionUid) {
  const digest = createHash('sha256').update(questionUid).digest('hex').slice(0, 32);
  return `official-${digest}`;
}

function questionIdForImport(chapId, item, idByIndex) {
  // Existing UWorld rows retain their historical chapter/index IDs so user
  // progress is not broken. New official-only records use an immutable source
  // identity, allowing a later chapter correction without changing their ID.
  if (typeof item.question_uid === 'string' && item.question_uid.startsWith('official:')) {
    return stableOfficialQuestionId(item.question_uid);
  }
  return idByIndex.get(item.index) ?? `${chapId}-${String(item.index).padStart(4, '0')}`;
}

function toParam(value) {
  if (value === undefined) return null;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

async function upsert(table, rows, conflictCols, { skipUpdate = false } = {}) {
  if (dryRun || rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const conflictColumns = conflictCols.split(',');
  const updateColumns = skipUpdate ? [] : columns.filter((c) => !conflictColumns.includes(c));

  const values = [];
  const valuePlaceholders = rows.map((row) => {
    const placeholders = columns.map((col) => {
      values.push(toParam(row[col]));
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  }).join(', ');

  const comparableColumns = updateColumns.filter((c) => c !== 'updated_at');
  const updateClause = updateColumns.length > 0
    ? updateColumns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
    : null;
  const updateWhere = comparableColumns.length > 0
    ? comparableColumns.map((c) => `public.${table}."${c}" IS DISTINCT FROM EXCLUDED."${c}"`).join(' OR ')
    : null;

  const sql = `
    INSERT INTO public.${table} (${columns.map((c) => `"${c}"`).join(', ')})
    VALUES ${valuePlaceholders}
    ON CONFLICT (${conflictColumns.map((c) => `"${c}"`).join(', ')})
    ${updateClause ? `DO UPDATE SET ${updateClause}${updateWhere ? ` WHERE ${updateWhere}` : ''}` : 'DO NOTHING'}
  `;
  await connection.query(sql, values);
}

async function replaceQuestionSources(questionIds, sourceRows) {
  if (dryRun || questionIds.length === 0) return;
  // The enriched file is canonical. Replacing source rows for the imported
  // questions removes stale provenance while the enclosing import transaction
  // guarantees that a failed run cannot leave a partial source map behind.
  await connection.query(
    'DELETE FROM public.question_sources WHERE question_id = ANY($1::text[])',
    [questionIds],
  );
  await upsert('question_sources', sourceRows, 'question_id,source_uid');
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
console.log(`Target: ${dryRun ? '(dry run)' : databaseUrl.replace(/:[^:@]*@/, ':***@')}`);
console.log('─'.repeat(60));

let totalQuestions = 0;
let transactionClient = null;

try {
  if (pool) {
    transactionClient = await pool.connect();
    connection = transactionClient;
    await connection.query('BEGIN');
  }

for (const file of files) {
  const { meta, items } = parseEnrichedDocument(JSON.parse(await readFile(file, 'utf8')));
  if (items.length === 0) continue;

  const relativeFile = path.relative(outDir, file);
  const chapId = chapterId(meta);
  console.log(`[${files.indexOf(file) + 1}/${files.length}] ${relativeFile}: ${items.length} questions`);

  const idByIndex = await fetchQuestionIdsByIndex(chapId, items);

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
  };

  const questionItems = [];
  const questionSources = [];

  for (const item of items) {
    const answer = normalizeChoiceKey(item.answer);
    if (!answer) {
      console.warn(`  ⚠ Skipping #${item.index}: invalid answer "${item.answer}"`);
      continue;
    }

    const questionId = questionIdForImport(chapId, item, idByIndex);
    const analysisMeta = questionAnalysisMeta(item);

    const enQuestion = String(item.question ?? '').trim();
    const zhQuestion = String(item['zh-question'] ?? '').trim();
    const stem = { en: enQuestion };
    if (zhQuestion) stem.zh = zhQuestion;

    const choices = [];
    choiceOrder.forEach((key, sortOrder) => {
      const enText = item.choices?.[key] ?? item.choices?.[key.toLowerCase()] ?? '';
      if (!enText) return;
      const zhText = item['zh-choices']?.[key] ?? item['zh-choices']?.[key.toLowerCase()] ?? '';
      const choice = { key: key.toLowerCase(), en: enText, sortOrder, isCorrect: key === answer };
      if (zhText) choice.zh = zhText;
      choices.push(choice);
    });

    const explanation = {};
    if (!isErrorHtml(item.explanation)) explanation.en = item.explanation;
    if (!isErrorHtml(item['zh-explanation'])) explanation.zh = item['zh-explanation'];

    questionItems.push({
      id: questionId,
      chapter_id: chapId,
      index: item.index,
      correct_answer: answer,
      is_ncbe: Array.isArray(item.tags) && item.tags.includes('ncbe'),
      stem,
      choices,
      explanation: Object.keys(explanation).length ? explanation : null,
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
    questionSources.push(...sourceRowsForQuestion(questionId, item));
  }

  await upsert('subjects', [subject], 'id', { skipUpdate: true });
  await upsert('chapters', [chapter], 'id');
  await upsert('question_items', questionItems, 'id');
  await replaceQuestionSources(questionItems.map((item) => item.id), questionSources);

  totalQuestions += questionItems.length;
  const tag = dryRun ? '[dry-run] ' : '';
  console.log(`  ↳ ${tag}questions:${questionItems.length}`);
}

  if (transactionClient) await connection.query('COMMIT');
} catch (err) {
  if (transactionClient) {
    try { await connection.query('ROLLBACK'); } catch { /* preserve original error */ }
  }
  console.error('Question import rolled back:', err.message);
  process.exitCode = 1;
} finally {
  if (transactionClient) transactionClient.release();
  if (pool) await pool.end();
}

if (!process.exitCode) {
  const verb = dryRun ? 'Validated' : 'Imported';
  console.log('─'.repeat(60));
  console.log(`${verb} ${totalQuestions} questions from ${files.length} files.`);
}
