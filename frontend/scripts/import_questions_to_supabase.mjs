import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const projectRoot = path.resolve(process.cwd(), '..');
const questionsDir = path.join(projectRoot, 'questions');
const supabase = createClient(supabaseUrl, serviceRoleKey);

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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

function choiceText(choices, letter) {
  return choices?.[letter.toLowerCase()] ?? choices?.[letter.toUpperCase()] ?? '';
}

function normalizeQuestion(filePath, data, item) {
  const subject = data.meta?.subject ?? path.basename(path.dirname(path.dirname(filePath)));
  const topic = data.meta?.chapter ?? path.basename(path.dirname(filePath)).replace(/_\d{4}-.*$/, '');
  const subjectInitials = slugify(subject).split('-').map((part) => part[0]).join('');
  const chapterId = `${subjectInitials}-${slugify(topic)}`;
  const options = ['a', 'b', 'c', 'd'].map((letter) => choiceText(item.choices, letter)).filter(Boolean);
  const correctLetter = String(item.correctAnswer ?? '').trim().toLowerCase();

  return {
    id: `${chapterId}-${item.index}`,
    subject,
    chapter_id: chapterId,
    topic,
    question_text: item.question,
    options,
    correct_answer: choiceText(item.choices, correctLetter),
    api_match_ok: true,
    explain_imgs: [],
    source_explanation_image_file: item.explanationImageFile ?? null,
    explanation_html: null,
    raw: item,
  };
}

const files = await listJsonFiles(questionsDir);
let imported = 0;

for (const file of files) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const questions = Array.isArray(data.questions) ? data.questions : [];
  const rows = questions
    .filter((item) => item.question && item.choices && item.correctAnswer)
    .map((item) => normalizeQuestion(file, data, item));

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from('questions').upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error(`Failed importing ${file}:`, error.message);
      process.exit(1);
    }
    imported += batch.length;
  }
}

console.log(`Imported ${imported} questions from ${files.length} JSON files.`);
