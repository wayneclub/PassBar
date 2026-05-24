import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_QUESTION_ASSETS_BUCKET ?? 'question-assets';
const dryRun = process.env.DRY_RUN === 'true';

if (!dryRun && (!supabaseUrl || !serviceRoleKey)) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const projectRoot = path.resolve(process.cwd(), '..');
const questionsDir = process.env.QUESTIONS_DIR
  ? path.resolve(process.env.QUESTIONS_DIR)
  : path.join(projectRoot, 'questions');
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

function questionId(meta, item) {
  return `${chapterId(meta)}-${String(item.index).padStart(4, '0')}`;
}

async function listJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsonFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith('.json')) return [fullPath];
    return [];
  }));
  return files.flat();
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
  const body = await readFile(filePath);
  if (dryRun) return { publicUrl: `dry-run://${storagePath}`, contentType };

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
    chapter: data.meta?.chapter ?? path.basename(path.dirname(filePath)).replace(/_\d{4}-.*$/, ''),
    examName: data.meta?.examName ?? null,
    sourceUrl: data.meta?.url ?? null,
    capturedAt: data.meta?.capturedAt ?? null,
    count: Number.isFinite(data.meta?.count) ? data.meta.count : null,
    screenshotCount: Number.isFinite(data.meta?.screenshotCount) ? data.meta.screenshotCount : null,
  };
}

function optionalText(item, keys) {
  for (const key of keys) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key];
  }
  return null;
}

function optionalFile(item, keys) {
  for (const key of keys) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key];
  }
  return null;
}

async function buildEnglishImageExplanation(filePath, meta, item, id) {
  if (!item.explanationImageFile) return null;

  const localImagePath = path.resolve(path.dirname(filePath), item.explanationImageFile);
  const storagePath = `${subjectId(meta)}/${slugify(meta.chapter)}/${id}/explanation-en${path.extname(localImagePath).toLowerCase()}`;
  const uploaded = await uploadImage(localImagePath, storagePath);

  return {
    question_id: id,
    language: 'en',
    explanation_text: null,
    explanation_html: null,
    explanation_image_file: item.explanationImageFile,
    storage_bucket: bucketName,
    storage_path: storagePath,
    public_url: uploaded.publicUrl,
    mime_type: uploaded.contentType,
    sort_order: 0,
    raw: { explanationImageFile: item.explanationImageFile },
  };
}

async function buildOptionalChineseExplanations(filePath, meta, item, id) {
  const explanations = [];
  const zhHtml = optionalText(item, [
    'chineseExplanationHtml',
    'zhExplanationHtml',
    'explanationHtmlZh',
    'sourceExplanationHtmlZh',
  ]);
  const zhText = optionalText(item, [
    'chineseExplanation',
    'zhExplanation',
    'explanationZh',
  ]);
  const zhImageFile = optionalFile(item, [
    'chineseExplanationImageFile',
    'zhExplanationImageFile',
    'explanationImageFileZh',
  ]);

  if (zhHtml) {
    explanations.push({
      question_id: id,
      language: 'zh',
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

  if (zhText) {
    explanations.push({
      question_id: id,
      language: 'zh',
      explanation_text: zhText,
      explanation_html: null,
      explanation_image_file: null,
      storage_bucket: null,
      storage_path: null,
      public_url: null,
      mime_type: 'text/plain',
      sort_order: 1,
      raw: null,
    });
  }

  if (zhImageFile) {
    const localImagePath = path.resolve(path.dirname(filePath), zhImageFile);
    const storagePath = `${subjectId(meta)}/${slugify(meta.chapter)}/${id}/explanation-zh${path.extname(localImagePath).toLowerCase()}`;
    const uploaded = await uploadImage(localImagePath, storagePath);
    explanations.push({
      question_id: id,
      language: 'zh',
      explanation_text: null,
      explanation_html: null,
      explanation_image_file: zhImageFile,
      storage_bucket: bucketName,
      storage_path: storagePath,
      public_url: uploaded.publicUrl,
      mime_type: uploaded.contentType,
      sort_order: 2,
      raw: { zhImageFile },
    });
  }

  return explanations;
}

function buildRows(filePath, data, item) {
  const meta = buildMeta(filePath, data);
  const id = questionId(meta, item);
  const correctKey = normalizeChoiceKey(item.correctAnswer);

  if (!correctKey) {
    throw new Error(`Invalid correctAnswer for ${filePath} #${item.index}: ${item.correctAnswer}`);
  }

  const subject = {
    id: subjectId(meta),
    subject: meta.subject,
    slug: subjectId(meta),
  };

  const chapter = {
    id: chapterId(meta),
    subject_id: subject.id,
    source: data.meta?.source ?? null,
    captured_at: meta.capturedAt,
    count: meta.count,
    screenshot_count: meta.screenshotCount,
    url: meta.sourceUrl,
    exam_name: meta.examName,
    subject: meta.subject,
    chapter: meta.chapter,
    slug: slugify(meta.chapter),
    raw_meta: data.meta ?? null,
  };

  const question = {
    id,
    chapter_id: chapter.id,
    index: item.index,
    question: item.question,
    correct_answer: correctKey,
    explanation_image_file: item.explanationImageFile ?? null,
    raw: item,
    updated_at: new Date().toISOString(),
  };

  const choices = choiceOrder.map((key, index) => ({
    question_id: id,
    choice_key: key.toLowerCase(),
    choice: item.choices?.[key.toLowerCase()] ?? item.choices?.[key] ?? '',
    sort_order: index,
    is_correct: key === correctKey,
  })).filter((choice) => choice.choice);

  return { meta, subject, chapter, question, choices };
}

async function upsert(table, rows, onConflict) {
  if (dryRun || rows.length === 0) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}

await ensureBucket();

const files = await listJsonFiles(questionsDir);
let importedQuestions = 0;
let importedChoices = 0;
let importedExplanations = 0;

for (const file of files) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const items = Array.isArray(data.questions) ? data.questions : [];
  const subjects = new Map();
  const chapters = new Map();
  const questions = [];
  const choices = [];
  const explanations = [];

  for (const item of items.filter((question) => question.question && question.choices && question.correctAnswer)) {
    const { meta, subject, chapter, question, choices: questionChoices } = buildRows(file, data, item);
    subjects.set(subject.id, subject);
    chapters.set(chapter.id, chapter);
    questions.push(question);
    choices.push(...questionChoices);

    const enImage = await buildEnglishImageExplanation(file, meta, item, question.id);
    if (enImage) explanations.push(enImage);
    explanations.push(...await buildOptionalChineseExplanations(file, meta, item, question.id));
  }

  try {
    await upsert('subjects', [...subjects.values()], 'id');
    await upsert('chapters', [...chapters.values()], 'id');
    await upsert('question_items', questions, 'id');
    await upsert('question_choices', choices, 'question_id,choice_key');
    await upsert('question_explanations', explanations, 'question_id,language,sort_order');
  } catch (error) {
    console.error(`Failed importing ${file}:`, error.message);
    process.exit(1);
  }

  importedQuestions += questions.length;
  importedChoices += choices.length;
  importedExplanations += explanations.length;
}

const verb = dryRun ? 'Validated' : 'Imported';
console.log(`${verb} ${importedQuestions} questions, ${importedChoices} choices, and ${importedExplanations} explanations from ${files.length} JSON files.`);
