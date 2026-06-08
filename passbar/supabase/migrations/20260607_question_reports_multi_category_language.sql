-- question_reports: support multi-select categories and record content language at report time
ALTER TABLE question_reports ADD COLUMN IF NOT EXISTS categories text[];
-- elements: 'wrong_answer' | 'typo' | 'unclear' | 'outdated' | 'explanation_incorrect' | 'other'

ALTER TABLE question_reports ADD COLUMN IF NOT EXISTS language text;
-- the interface/explanation language the user was viewing when reporting: 'en' | 'zh-TW' | 'zh-CN'

-- Backfill categories from the existing single-value category column
UPDATE question_reports SET categories = ARRAY[category] WHERE categories IS NULL;
