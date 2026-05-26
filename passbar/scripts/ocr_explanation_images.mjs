import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { imageSize } from 'image-size';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createWorker } from 'tesseract.js';

dotenv.config({ path: '.env.local', override: false });
dotenv.config({ path: '.env', override: false });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.env.DRY_RUN === 'true';
const language = process.env.OCR_LANGUAGE || 'eng';
const source = process.env.OCR_SOURCE || 'uworld';
const limit = Number.parseInt(process.env.OCR_LIMIT || '0', 10);
const force = process.env.OCR_FORCE === 'true';
const lookupBatchSize = Number.parseInt(process.env.OCR_LOOKUP_BATCH_SIZE || '50', 10);
const projectRoot = path.resolve(process.cwd(), '..');
const outDir = process.env.QUESTIONS_OUT_DIR
  ? path.resolve(process.env.QUESTIONS_OUT_DIR)
  : process.env.OUT_DIR
    ? path.resolve(process.env.OUT_DIR)
    : path.join(projectRoot, 'out');
const useLocalImages = process.env.OCR_USE_LOCAL_IMAGES !== 'false';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing required env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const choiceOrder = ['A', 'B', 'C', 'D'];

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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

function buildMeta(filePath, data) {
  return {
    subject: data.meta?.subject ?? path.basename(path.dirname(path.dirname(filePath))),
    chapter: data.meta?.chapter ?? path.basename(path.dirname(filePath)),
  };
}

function getFetchedItem(item) {
  const data = Array.isArray(item.apiResult?.data) ? item.apiResult.data : [];
  if (!item.apiResult?.ok || data.length === 0) return null;
  if (item.apiMatchOk === false || item.apiResult?._match_ok === false) return null;
  return data[0];
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

function localImageKey(row) {
  return [
    row.question_id,
    row.source,
    row.language,
    Number.isFinite(row.sort_order) ? row.sort_order : 0,
    row.explanation_image_file ?? '',
  ].join('|');
}

async function buildLocalImageIndex() {
  const index = new Map();
  if (!useLocalImages || !(await fileExists(outDir))) return index;

  const files = await listJsonFiles(outDir);
  for (const filePath of files) {
    const data = JSON.parse(await readFile(filePath, 'utf8'));
    const meta = buildMeta(filePath, data);
    const items = Array.isArray(data.questions) ? data.questions : [];

    for (const item of items) {
      const apiItem = getFetchedItem(item);
      const id = questionId(meta, item, apiItem);
      if (item.sourceExplanationImageFile) {
        const imagePath = path.resolve(path.dirname(filePath), item.sourceExplanationImageFile);
        index.set([id, 'uworld', 'en', 0, item.sourceExplanationImageFile].join('|'), imagePath);
      }

      if (Array.isArray(apiItem?.explain_img_files)) {
        apiItem.explain_img_files.forEach((imageFile, imageIndex) => {
          if (!imageFile) return;
          const imagePath = path.resolve(path.dirname(filePath), imageFile);
          index.set([id, 'castudy', 'zh', imageIndex + 1, imageFile].join('|'), imagePath);
        });
      }
    }
  }

  return index;
}

function normalizeWord(word, imageWidth, imageHeight) {
  const bbox = word.bbox ?? {};
  const x0 = Number.isFinite(bbox.x0) ? bbox.x0 : 0;
  const y0 = Number.isFinite(bbox.y0) ? bbox.y0 : 0;
  const x1 = Number.isFinite(bbox.x1) ? bbox.x1 : x0;
  const y1 = Number.isFinite(bbox.y1) ? bbox.y1 : y0;

  return {
    text: word.text,
    confidence: word.confidence ?? null,
    bbox: {
      x: imageWidth > 0 ? x0 / imageWidth : 0,
      y: imageHeight > 0 ? y0 / imageHeight : 0,
      width: imageWidth > 0 ? (x1 - x0) / imageWidth : 0,
      height: imageHeight > 0 ? (y1 - y0) / imageHeight : 0,
    },
  };
}

function flattenWords(blocks = []) {
  return blocks.flatMap((block) => (
    (block.paragraphs ?? []).flatMap((paragraph) => (
      (paragraph.lines ?? []).flatMap((line) => line.words ?? [])
    ))
  ));
}

async function getImageBuffer(row, localImageIndex) {
  const localPath = localImageIndex.get(localImageKey(row));
  if (localPath) {
    return readFile(localPath);
  }

  if (useLocalImages) {
    throw new Error(`Missing local OCR image for ${row.question_id}: ${row.explanation_image_file ?? row.public_url}`);
  }

  const url = row.public_url;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image ${url}: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function getProcessedExplanationIds(explanationIds) {
  const processed = new Set();
  const uniqueIds = Array.from(new Set(explanationIds.filter(Boolean)));
  const batchSize = Number.isFinite(lookupBatchSize) && lookupBatchSize > 0 ? lookupBatchSize : 50;

  for (const batch of chunk(uniqueIds, batchSize)) {
    const { data, error } = await supabase
      .from('question_explanation_ocr')
      .select('explanation_id')
      .in('explanation_id', batch)
      .eq('language', language);

    if (error) throw error;
    (data ?? []).forEach((row) => processed.add(row.explanation_id));
  }

  return processed;
}

async function getExplanationRows() {
  let query = supabase
    .from('question_explanations')
    .select('id, question_id, language, source, explanation_image_file, storage_bucket, storage_path, public_url, sort_order')
    .not('public_url', 'is', null)
    .order('id', { ascending: true });

  if (source !== 'all') query = query.eq('source', source);
  if (limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  if (dryRun || force || rows.length === 0) return rows;

  const processed = await getProcessedExplanationIds(rows.map((row) => row.id));
  return rows.filter((row) => !processed.has(row.id));
}

async function main() {
  const localImageIndex = await buildLocalImageIndex();
  const rows = await getExplanationRows();
  console.log(`Found ${rows.length} explanation image(s) to OCR. language=${language} source=${source} force=${force} localImages=${useLocalImages} outDir=${outDir}`);
  if (dryRun || rows.length === 0) return;

  const worker = await createWorker(language);

  try {
    for (const [index, row] of rows.entries()) {
      console.log(`[${index + 1}/${rows.length}] ${row.question_id} ${row.public_url}`);
      const imageBuffer = await getImageBuffer(row, localImageIndex);
      const dimensions = imageSize(imageBuffer);
      const result = await worker.recognize(imageBuffer, {}, { text: true, blocks: true });
      const imageWidth = dimensions.width ?? 0;
      const imageHeight = dimensions.height ?? 0;
      const words = flattenWords(result.data?.blocks ?? [])
        .filter((word) => word.text && word.text.trim())
        .map((word) => normalizeWord(word, imageWidth, imageHeight));

      const { error } = await supabase
        .from('question_explanation_ocr')
        .upsert({
          question_id: row.question_id,
          explanation_id: row.id,
          storage_bucket: row.storage_bucket,
          storage_path: row.storage_path,
          public_url: row.public_url,
          language,
          engine: 'tesseract.js',
          image_width: imageWidth || null,
          image_height: imageHeight || null,
          text: result.data?.text ?? '',
          words,
          raw: {
            confidence: result.data?.confidence ?? null,
            source: row.source,
            explanation_language: row.language,
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'public_url,language' });

      if (error) throw error;
      console.log(`  saved ${words.length} word boxes`);
    }
  } finally {
    await worker.terminate();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
