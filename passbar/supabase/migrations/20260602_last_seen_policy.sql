-- Allow authenticated users to update their own last_seen_at
-- (profiles table should already have this column; this just ensures the policy exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'users_update_own_last_seen'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "users_update_own_last_seen"
        ON profiles FOR UPDATE TO authenticated
        USING (auth.uid() = id)
        WITH CHECK (auth.uid() = id)
    $policy$;
  END IF;
END $$;
