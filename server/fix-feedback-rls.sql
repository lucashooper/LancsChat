-- Fix feedback table RLS — run in Supabase SQL Editor
-- Removes public read/write exposure of feedback emails to all authenticated users.

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON feedback;
DROP POLICY IF EXISTS "Authenticated users can view feedback" ON feedback;
DROP POLICY IF EXISTS "Users insert own feedback" ON feedback;
DROP POLICY IF EXISTS "Users view own feedback" ON feedback;
DROP POLICY IF EXISTS "Admins read all feedback" ON feedback;

-- No direct client access: feedback is submitted/read via the LancsChat server (service role).
-- If you need a temporary client insert policy during migration, use ONLY insert + own row:
-- CREATE POLICY "Users insert own feedback"
--   ON feedback FOR INSERT TO authenticated
--   WITH CHECK (auth.uid() = user_id);

-- Optional: allow users to read only their own submissions (still no email exposure to others)
CREATE POLICY "Users view own feedback"
  ON feedback FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
