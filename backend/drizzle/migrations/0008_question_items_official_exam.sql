ALTER TABLE "question_items"
  ADD COLUMN IF NOT EXISTS "is_official_exam" boolean NOT NULL DEFAULT false;

-- Backfill from the canonical enriched raw payload for existing imported rows.
UPDATE "question_items"
SET "is_official_exam" = COALESCE(("raw" -> 'tags') ? 'official_exam', false)
WHERE "is_official_exam" = false;

CREATE INDEX IF NOT EXISTS "question_items_official_exam_idx"
  ON "question_items" ("chapter_id", "index")
  WHERE "is_official_exam" = true;
