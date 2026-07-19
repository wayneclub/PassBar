-- Keep source provenance queryable without forcing normal question reads to
-- parse question_items.raw JSONB. A source UID identifies one source question
-- globally; the composite primary key also supports a question with many sources.
CREATE TABLE IF NOT EXISTS "question_sources" (
  "question_id" text NOT NULL REFERENCES "question_items"("id") ON DELETE CASCADE,
  "source_uid" text NOT NULL,
  "provider" text NOT NULL,
  "source_type" text NOT NULL,
  "source_file" text,
  "source_format" text,
  "source_question_number" integer,
  "source_sha256" text,
  "answer_key" text,
  "is_official_exam" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "question_sources_question_id_source_uid_pk" PRIMARY KEY ("question_id", "source_uid"),
  CONSTRAINT "question_sources_source_uid_unique" UNIQUE ("source_uid")
);

CREATE INDEX IF NOT EXISTS "question_sources_source_type_question_id_idx"
  ON "question_sources" ("source_type", "question_id");

CREATE INDEX IF NOT EXISTS "question_sources_provider_question_id_idx"
  ON "question_sources" ("provider", "question_id");

-- Backfill canonical provenance already held in the imported enriched payload.
INSERT INTO "question_sources" (
  "question_id", "source_uid", "provider", "source_type", "source_file",
  "source_format", "source_question_number", "source_sha256", "answer_key",
  "is_official_exam"
)
SELECT
  q."id",
  p->>'source_uid',
  p->>'provider',
  p->>'source_type',
  NULLIF(p->>'source_file', ''),
  NULLIF(p->>'format', ''),
  CASE
    WHEN COALESCE(p->>'source_question_number', '') ~ '^[0-9]+$'
      THEN (p->>'source_question_number')::integer
    ELSE NULL
  END,
  NULLIF(p->>'source_sha256', ''),
  NULLIF(p->>'answer_key', ''),
  COALESCE(p->>'source_type', '') = 'official_exam'
FROM "question_items" q
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q."raw"->'provenance', '[]'::jsonb)) p
WHERE COALESCE(p->>'source_uid', '') <> ''
  AND COALESCE(p->>'provider', '') <> ''
  AND COALESCE(p->>'source_type', '') <> ''
ON CONFLICT ("question_id", "source_uid") DO UPDATE
SET
  "provider" = EXCLUDED."provider",
  "source_type" = EXCLUDED."source_type",
  "source_file" = EXCLUDED."source_file",
  "source_format" = EXCLUDED."source_format",
  "source_question_number" = EXCLUDED."source_question_number",
  "source_sha256" = EXCLUDED."source_sha256",
  "answer_key" = EXCLUDED."answer_key",
  "is_official_exam" = EXCLUDED."is_official_exam",
  "updated_at" = now();
