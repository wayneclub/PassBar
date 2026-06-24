import { Pool } from 'pg';
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
  const { rows } = await pool.query(
    'SELECT id, "index" FROM public.question_items WHERE chapter_id = $1',
    [chapId],
  );
  return new Map(rows.map((row) => [row.index, row.id]));
}

function toParam(value) {
  if (value === undefined) return null;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

async function upsert(table, rows, conflictCols) {
  if (dryRun || rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const conflictColumns = conflictCols.split(',');
  const updateColumns = columns.filter((c) => !conflictColumns.includes(c));

  const values = [];
  const valuePlaceholders = rows.map((row) => {
    const placeholders = columns.map((col) => {
      values.push(toParam(row[col]));
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  }).join(', ');

  const updateClause = updateColumns.length > 0
    ? updateColumns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
    : null;

  const sql = `
    INSERT INTO public.${table} (${columns.map((c) => `"${c}"`).join(', ')})
    VALUES ${valuePlaceholders}
    ON CONFLICT (${conflictColumns.map((c) => `"${c}"`).join(', ')})
    ${updateClause ? `DO UPDATE SET ${updateClause}` : 'DO NOTHING'}
  `;
  await pool.query(sql, values);
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
  };

  const questionItems = [];

  for (const item of items) {
    const answer = normalizeChoiceKey(item.answer);
    if (!answer) {
      console.warn(`  ⚠ Skipping #${item.index}: invalid answer "${item.answer}"`);
      continue;
    }

    const questionId = idByIndex.get(item.index) ?? `${chapId}-${String(item.index).padStart(4, '0')}`;
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
  }

  try {
    await upsert('subjects', [subject], 'id');
    await upsert('chapters', [chapter], 'id');
    await upsert('question_items', questionItems, 'id');
  } catch (err) {
    console.error(`  Failed importing ${relativeFile}:`, err.message);
    process.exit(1);
  }

  totalQuestions += questionItems.length;
  const tag = dryRun ? '[dry-run] ' : '';
  console.log(`  ↳ ${tag}questions:${questionItems.length}`);
}

const verb = dryRun ? 'Validated' : 'Imported';
console.log('─'.repeat(60));
console.log(`${verb} ${totalQuestions} questions from ${files.length} files.`);

if (pool) await pool.end();
