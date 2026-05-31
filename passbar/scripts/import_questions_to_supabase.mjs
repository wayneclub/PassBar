import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

dotenv.config({ path: '.env.local', override: false });
dotenv.config({ path: '.env', override: false });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_QUESTION_ASSETS_BUCKET ?? 'question-assets';
const dryRun = process.env.DRY_RUN === 'true';
const uploadConcurrency = Number.parseInt(process.env.SUPABASE_UPLOAD_CONCURRENCY ?? '8', 10);

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
const mimeTypes = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

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

function fallbackQuestionId(meta, item) {
  return `${chapterId(meta)}-${String(item.index).padStart(4, '0')}`;
}

function questionId(meta, item, apiItem) {
  const qid = typeof apiItem?.qid === 'string' ? apiItem.qid.trim() : '';
  return qid ? qid.toLowerCase() : fallbackQuestionId(meta, item);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsonFiles(fullPath);
    if (
      entry.isFile() &&
      entry.name.endsWith('.json') &&
      !entry.name.endsWith('.failed.json') &&
      !entry.name.endsWith('_enriched.json')   // enriched files handled in Phase 2
    ) {
      return [fullPath];
    }
    return [];
  }));
  return files.flat().sort();
}

async function ensureBucket() {
  if (dryRun) return;
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;
  if (buckets.some((bucket) => bucket.name === bucketName)) return;

  const { error } = await supabase.storage.createBucket(bucketName, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: Array.from(new Set(mimeTypes.values())),
  });
  if (error) throw error;
}

async function uploadImage(filePath, storagePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(ext) ?? 'application/octet-stream';
  const exists = await fileExists(filePath);
  if (!exists) {
    throw new Error(`Missing image file: ${filePath}`);
  }

  if (dryRun) return { publicUrl: `dry-run://${storagePath}`, contentType };

  const body = await readFile(filePath);
  const { error } = await supabase.storage.from(bucketName).upload(storagePath, body, {
    contentType,
    upsert: true,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(bucketName).getPublicUrl(storagePath);
  return { publicUrl: data.publicUrl, contentType };
}

function buildMeta(filePath, data) {
  return {
    subject: data.meta?.subject ?? path.basename(path.dirname(path.dirname(filePath))),
    chapter: data.meta?.chapter ?? path.basename(path.dirname(filePath)),
    examName: data.meta?.examName ?? null,
    sourceInput: data.meta?.sourceInput ?? null,
    generatedAt: data.meta?.generatedAt ?? null,
    count: Number.isFinite(data.meta?.count) ? data.meta.count : null,
    failedCount: Number.isFinite(data.meta?.failedCount) ? data.meta.failedCount : null,
    api: data.meta?.api ?? null,
  };
}

function getFetchedItem(item) {
  const data = Array.isArray(item.apiResult?.data) ? item.apiResult.data : [];
  if (!item.apiResult?.ok || data.length === 0) return null;
  if (item.apiMatchOk === false || item.apiResult?._match_ok === false) return null;
  return data[0];
}

function buildSubject(meta) {
  return {
    id: subjectId(meta),
    subject: meta.subject,
    slug: subjectId(meta),
  };
}

function buildChapter(meta, rawMeta) {
  return {
    id: chapterId(meta),
    subject_id: subjectId(meta),
    source: meta.sourceInput,
    captured_at: meta.generatedAt,
    count: meta.count,
    screenshot_count: null,
    url: meta.api?.base ?? null,
    exam_name: meta.examName,
    subject: meta.subject,
    chapter: meta.chapter,
    slug: slugify(meta.chapter),
    raw_meta: rawMeta ?? null,
  };
}

function buildQuestion(meta, item, apiItem) {
  const sourceCorrectAnswer = normalizeChoiceKey(item.sourceCorrectAnswer);
  if (!sourceCorrectAnswer) {
    throw new Error(`Invalid sourceCorrectAnswer for ${meta.subject}/${meta.chapter} #${item.index}: ${item.sourceCorrectAnswer}`);
  }

  const apiAnswerKey = normalizeChoiceKey(apiItem?.answerKey);
  const id = questionId(meta, item, apiItem);
  return {
    id,
    chapter_id: chapterId(meta),
    index: item.index,
    question: item.question,
    correct_answer: sourceCorrectAnswer,
    explanation_image_file: item.sourceExplanationImageFile ?? null,
    source_question: item.question,
    source_choices: item.choices ?? null,
    source_correct_answer: sourceCorrectAnswer,
    source_explanation_html: item.sourceExplanationHtml ?? null,
    source_explanation_image_file: item.sourceExplanationImageFile ?? null,
    api_qid: apiItem?.qid ?? null,
    api_answer_key: apiAnswerKey,
    api_match_ok: item.apiMatchOk ?? item.apiResult?._match_ok ?? null,
    api_match_score: item.apiMatchScore ?? item.apiResult?._match_score ?? null,
    api_url: item.apiResult?.url ?? null,
    api_status: item.apiResult?.status ?? null,
    raw: item,
    updated_at: new Date().toISOString(),
  };
}

function buildQuestionTexts(question, apiItem) {
  const rows = [{
    question_id: question.id,
    language: 'en',
    source: 'uworld',
    question_stem: question.source_question,
    raw: null,
  }];

  if (apiItem?.questionStem) {
    rows.push({
      question_id: question.id,
      language: 'mixed',
      source: 'castudy',
      question_stem: apiItem.questionStem,
      raw: { qid: apiItem.qid ?? null },
    });
  }

  return rows;
}

function buildEnglishChoices(question, item) {
  return choiceOrder.map((key, sortOrder) => ({
    question_id: question.id,
    language: 'en',
    source: 'uworld',
    choice_key: key.toLowerCase(),
    choice: item.choices?.[key.toLowerCase()] ?? item.choices?.[key] ?? '',
    sort_order: sortOrder,
    is_correct: key === question.source_correct_answer,
    raw: null,
  })).filter((choice) => choice.choice);
}

function buildFetchedChoices(question, apiItem) {
  if (!Array.isArray(apiItem?.options)) return [];
  const correctKey = normalizeChoiceKey(apiItem.answerKey);
  return apiItem.options.map((option, sortOrder) => {
    const key = normalizeChoiceKey(String(option).match(/^\s*([A-D])\./i)?.[1]);
    return {
      question_id: question.id,
      language: 'mixed',
      source: 'castudy',
      choice_key: (key ?? choiceOrder[sortOrder] ?? String(sortOrder + 1)).toLowerCase(),
      choice: option,
      sort_order: sortOrder,
      is_correct: key ? key === correctKey : sortOrder === choiceOrder.indexOf(correctKey),
      raw: { answerKey: apiItem.answerKey ?? null },
    };
  }).filter((choice) => choice.choice);
}

async function buildEnglishImageExplanation(filePath, meta, item, question) {
  if (!item.sourceExplanationImageFile) return null;

  const localImagePath = path.resolve(path.dirname(filePath), item.sourceExplanationImageFile);
  const ext = path.extname(localImagePath).toLowerCase();
  const storagePath = `${subjectId(meta)}/${slugify(meta.chapter)}/${question.id}/source-en${ext}`;
  const uploaded = await uploadImage(localImagePath, storagePath);

  return {
    question_id: question.id,
    language: 'en',
    source: 'uworld',
    explanation_text: null,
    explanation_html: item.sourceExplanationHtml || null,
    explanation_image_file: item.sourceExplanationImageFile,
    storage_bucket: bucketName,
    storage_path: storagePath,
    public_url: uploaded.publicUrl,
    mime_type: uploaded.contentType,
    sort_order: 0,
    raw: { sourceExplanationImageFile: item.sourceExplanationImageFile },
  };
}

function buildChineseHtmlExplanation(question, apiItem) {
  if (!apiItem?.htmlContent) return null;
  return {
    question_id: question.id,
    language: 'zh',
    source: 'castudy',
    explanation_text: null,
    explanation_html: apiItem.htmlContent,
    explanation_image_file: null,
    storage_bucket: null,
    storage_path: null,
    public_url: null,
    mime_type: 'text/html',
    sort_order: 0,
    raw: {
      qid: apiItem.qid ?? null,
      explain_imgs: apiItem.explain_imgs ?? [],
    },
  };
}

async function buildChineseImageExplanations(filePath, meta, apiItem, question) {
  if (!Array.isArray(apiItem?.explain_img_files)) return [];

  const rows = [];
  for (const [index, imageFile] of apiItem.explain_img_files.entries()) {
    if (!imageFile) continue;
    const localImagePath = path.resolve(path.dirname(filePath), imageFile);
    const ext = path.extname(localImagePath).toLowerCase();
    const storagePath = `${subjectId(meta)}/${slugify(meta.chapter)}/${question.id}/zh-${String(index + 1).padStart(2, '0')}${ext}`;
    const uploaded = await uploadImage(localImagePath, storagePath);

    rows.push({
      question_id: question.id,
      language: 'zh',
      source: 'castudy',
      explanation_text: null,
      explanation_html: null,
      explanation_image_file: imageFile,
      storage_bucket: bucketName,
      storage_path: storagePath,
      public_url: uploaded.publicUrl,
      mime_type: uploaded.contentType,
      sort_order: index + 1,
      raw: {
        remote_url: Array.isArray(apiItem.explain_imgs) ? apiItem.explain_imgs[index] : null,
      },
    });
  }
  return rows;
}

async function upsert(table, rows, onConflict) {
  if (dryRun || rows.length === 0) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

await ensureBucket();

const files = await listJsonFiles(outDir);
let importedQuestions = 0;
let importedTexts = 0;
let importedChoices = 0;
let importedExplanations = 0;
let fetchedQuestions = 0;

for (const file of files) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const items = Array.isArray(data.questions) ? data.questions : [];
  const meta = buildMeta(file, data);
  const relativeFile = path.relative(outDir, file);
  const subjects = new Map();
  const chapters = new Map();
  const questions = [];
  const questionTexts = [];
  const choices = [];
  const explanations = [];
  const explanationTasks = [];

  console.log(`[${files.indexOf(file) + 1}/${files.length}] ${relativeFile}: ${items.length} questions`);

  subjects.set(subjectId(meta), buildSubject(meta));
  chapters.set(chapterId(meta), buildChapter(meta, data.meta));

  for (const item of items.filter((question) => question.question && question.choices && question.sourceCorrectAnswer)) {
    const apiItem = getFetchedItem(item);
    const question = buildQuestion(meta, item, apiItem);
    questions.push(question);
    questionTexts.push(...buildQuestionTexts(question, apiItem));
    choices.push(...buildEnglishChoices(question, item));
    choices.push(...buildFetchedChoices(question, apiItem));

    if (apiItem) fetchedQuestions += 1;

    if (item.sourceExplanationImageFile) {
      explanationTasks.push(async () => {
        const enImage = await buildEnglishImageExplanation(file, meta, item, question);
        return enImage ? [enImage] : [];
      });
    }

    const zhHtml = buildChineseHtmlExplanation(question, apiItem);
    if (zhHtml) explanations.push(zhHtml);

    if (Array.isArray(apiItem?.explain_img_files) && apiItem.explain_img_files.length > 0) {
      explanationTasks.push(() => buildChineseImageExplanations(file, meta, apiItem, question));
    }
  }

  const uploadedExplanationChunks = await mapLimit(
    explanationTasks,
    Number.isFinite(uploadConcurrency) ? uploadConcurrency : 8,
    (task) => task(),
  );
  explanations.push(...uploadedExplanationChunks.flat());

  try {
    await upsert('subjects', [...subjects.values()], 'id');
    await upsert('chapters', [...chapters.values()], 'id');
    await upsert('question_items', questions, 'id');
    await upsert('question_texts', questionTexts, 'question_id,language,source');
    await upsert('question_choices', choices, 'question_id,language,choice_key');
    await upsert('question_explanations', explanations, 'question_id,language,source,sort_order');
  } catch (error) {
    console.error(`Failed importing ${file}:`, error.message);
    process.exit(1);
  }

  importedQuestions += questions.length;
  importedTexts += questionTexts.length;
  importedChoices += choices.length;
  importedExplanations += explanations.length;
  console.log(`  upserted ${questions.length} questions, ${choices.length} choices, ${explanations.length} explanations/assets`);
}

const verb = dryRun ? 'Validated' : 'Imported';
console.log(`${verb} ${importedQuestions} questions (${fetchedQuestions} with fetched data), ${importedTexts} question texts, ${importedChoices} choices, and ${importedExplanations} explanations/assets from ${files.length} JSON files in ${outDir}.`);

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: import enriched JSON fields
// (zh-question, zh-choices, explanation HTML, zh-explanation HTML)
//
// Enriched JSONs use a flat array and do NOT carry apiResult / qid, so we
// can't recompute the original question ID.  Instead we query the DB for the
// real ID via (chapter_id, index), then upsert only the new / updated fields.
// ─────────────────────────────────────────────────────────────────────────────

function isErrorHtml(html) {
  return !html || String(html).trimStart().startsWith('<!-- ERROR:');
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

/** Fetch the real question IDs from the DB for a given chapter, keyed by index. */
async function fetchQuestionIdsByIndex(chapId, items) {
  if (dryRun) {
    // In dry-run, generate fallback IDs so the rest of the logic can run
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

const enrichedFiles = await listEnrichedFiles(outDir);

if (enrichedFiles.length === 0) {
  console.log('\nNo enriched JSON files found — skipping Phase 2.');
} else {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Phase 2: importing enriched fields from ${enrichedFiles.length} file(s) …`);
  console.log('─'.repeat(60));

  let enrichedTexts = 0;
  let enrichedChoices = 0;
  let enrichedExplanations = 0;
  let enrichedSkipped = 0;

  for (const file of enrichedFiles) {
    const items = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(items) || items.length === 0) continue;

    const relativeFile = path.relative(outDir, file);
    const firstItem = items[0];
    const subject = firstItem.subject ?? '';
    const chapter = firstItem.chapter ?? '';
    const meta = { subject, chapter };
    const chapId = chapterId(meta);

    console.log(`  [${enrichedFiles.indexOf(file) + 1}/${enrichedFiles.length}] ${relativeFile}`);

    // Look up real question IDs (index → question_id)
    let idByIndex;
    try {
      idByIndex = await fetchQuestionIdsByIndex(chapId, items);
    } catch (err) {
      console.error(`    WARN: cannot fetch question IDs for ${chapId}: ${err.message} — skipping`);
      enrichedSkipped += items.length;
      continue;
    }

    const texts = [];
    const choices = [];
    const explanations = [];
    // All question IDs found in enriched JSON (authoritative: will replace old records)
    const enrichedQuestionIds = [];

    for (const item of items) {
      const questionId = idByIndex.get(item.index);
      if (!questionId) {
        // Question not yet in DB — castudy import hasn't run yet for this chapter
        enrichedSkipped += 1;
        continue;
      }

      // This question exists in enriched JSON → it is the authoritative version.
      // We will delete old mixed/castudy records for it after upserting new ones.
      enrichedQuestionIds.push(questionId);

      // ── zh question stem ──────────────────────────────────────────────────
      const zhQuestion = (item['zh-question'] ?? '').trim();
      if (zhQuestion) {
        texts.push({
          question_id: questionId,
          language: 'zh',
          source: 'enriched',
          question_stem: zhQuestion,
          raw: null,
        });
      }

      // ── zh choices ────────────────────────────────────────────────────────
      const zhChoices = item['zh-choices'] ?? {};
      choiceOrder.forEach((key, sortOrder) => {
        const text = zhChoices[key] ?? zhChoices[key.toLowerCase()] ?? '';
        if (!text) return;
        choices.push({
          question_id: questionId,
          language: 'zh',
          source: 'enriched',
          choice_key: key.toLowerCase(),
          choice: text,
          sort_order: sortOrder,
          is_correct: key === String(item.answer ?? '').toUpperCase(),
          raw: null,
        });
      });

      // ── en explanation HTML (enriched: gemini-generated interactive HTML) ─
      const enHtml = item.explanation ?? '';
      if (!isErrorHtml(enHtml)) {
        explanations.push({
          question_id: questionId,
          language: 'en',
          source: 'enriched',
          explanation_text: null,
          explanation_html: enHtml,
          explanation_image_file: item.source_img ?? null,
          storage_bucket: null,
          storage_path: null,
          public_url: null,
          mime_type: 'text/html',
          sort_order: 0,
          raw: { source_img: item.source_img ?? null },
        });
      }

      // ── zh explanation HTML (enriched: castudy htmlContent or gemini) ─────
      const zhHtml = item['zh-explanation'] ?? '';
      if (!isErrorHtml(zhHtml)) {
        explanations.push({
          question_id: questionId,
          language: 'zh',
          source: 'enriched',
          explanation_text: null,
          explanation_html: zhHtml,
          explanation_image_file: null,
          storage_bucket: null,
          storage_path: null,
          public_url: null,
          mime_type: 'text/html',
          sort_order: 0,
          raw: null,
        });
      }
    }

    try {
      // 1. Upsert enriched records (source='enriched' is the authoritative version)
      await upsert('question_texts',        texts,        'question_id,language,source');
      await upsert('question_choices',      choices,      'question_id,language,choice_key');
      await upsert('question_explanations', explanations, 'question_id,language,source,sort_order');

      if (!dryRun && enrichedQuestionIds.length > 0) {
        // 2. For every question present in enriched JSON, delete the old
        //    mixed-language records (bilingual stem/choices from castudy API)
        //    — enriched JSON has replaced them with pure-language versions.
        const { error: e1 } = await supabase
          .from('question_texts')
          .delete()
          .in('question_id', enrichedQuestionIds)
          .eq('language', 'mixed');
        if (e1) throw e1;

        const { error: e2 } = await supabase
          .from('question_choices')
          .delete()
          .in('question_id', enrichedQuestionIds)
          .eq('language', 'mixed');
        if (e2) throw e2;

        // 3. Delete old castudy zh explanation — enriched JSON's zh-explanation
        //    is now the single authoritative zh record (source='enriched').
        const { error: e3 } = await supabase
          .from('question_explanations')
          .delete()
          .in('question_id', enrichedQuestionIds)
          .eq('language', 'zh')
          .eq('source', 'castudy');
        if (e3) throw e3;
      }
    } catch (err) {
      console.error(`    Failed importing enriched data for ${relativeFile}:`, err.message);
      continue;
    }

    enrichedTexts        += texts.length;
    enrichedChoices      += choices.length;
    enrichedExplanations += explanations.length;
    const tag = dryRun ? '[dry-run] ' : '';
    console.log(`    ↳ ${tag}upsert  zh_texts:${texts.length}  zh_choices:${choices.length}  explanations:${explanations.length}`);
    console.log(`    ↳ ${tag}replace mixed/castudy records for ${enrichedQuestionIds.length} questions  (skipped:${enrichedSkipped})`);
  }

  const verb2 = dryRun ? 'Would upsert' : 'Upserted';
  console.log(`\nPhase 2 done. ${verb2} ${enrichedTexts} zh texts, ${enrichedChoices} zh choices, ${enrichedExplanations} explanation HTMLs. Skipped ${enrichedSkipped} (question not in DB yet).`);
}
