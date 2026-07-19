-- NCBE is the concrete provider shown to learners. Keep source_type values
-- such as `official_exam` as provenance semantics, but rename the fast
-- question classification projection to the provider name.
ALTER TABLE "question_items" RENAME COLUMN "is_official_exam" TO "is_ncbe";
ALTER TABLE "question_sources" RENAME COLUMN "is_official_exam" TO "is_ncbe";
ALTER INDEX "question_items_official_exam_idx" RENAME TO "question_items_ncbe_idx";

UPDATE "question_sources"
SET "is_ncbe" = ("provider" = 'ncbe');

UPDATE "question_items" q
SET "is_ncbe" = EXISTS (
  SELECT 1 FROM "question_sources" s
  WHERE s."question_id" = q."id" AND s."is_ncbe"
);
