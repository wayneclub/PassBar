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
    if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.failed.json')) {
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
