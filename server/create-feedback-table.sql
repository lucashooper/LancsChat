-- Feedback table for user submissions
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  user_display_name TEXT,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('feature_request', 'bug_report', 'other')),
  feedback_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'in_progress', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Feedback is written/read via the LancsChat server (service role).
-- Users may optionally read only their own rows; admins use the server admin API.
DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON feedback;
DROP POLICY IF EXISTS "Authenticated users can view feedback" ON feedback;

CREATE POLICY "Users view own feedback"
  ON feedback FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
