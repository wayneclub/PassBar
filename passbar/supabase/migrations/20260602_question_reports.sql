-- question_reports: user feedback on individual questions
CREATE TABLE IF NOT EXISTS question_reports (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id   text        NOT NULL,
  user_id       uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  category      text        NOT NULL DEFAULT 'other',
  -- 'wrong_answer' | 'typo' | 'unclear' | 'outdated' | 'other'
  message       text,
  resolved      boolean     NOT NULL DEFAULT false,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE question_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_insert_own_reports"
  ON question_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins_select_reports"
  ON question_reports FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

CREATE POLICY "admins_update_reports"
  ON question_reports FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- Add user_agent tracking to practice_sessions for browser/device analytics
ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS user_agent text;
