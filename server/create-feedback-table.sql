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

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);

-- Enable Row Level Security
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Policy: Any authenticated user can insert feedback
CREATE POLICY "Authenticated users can insert feedback"
  ON feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: Any authenticated user can view all feedback (admin check done in app layer)
CREATE POLICY "Authenticated users can view feedback"
  ON feedback
  FOR SELECT
  TO authenticated
  USING (true);

-- NOTE: If you already ran the old policies, drop them first:
-- DROP POLICY IF EXISTS "Users can insert their own feedback" ON feedback;
-- DROP POLICY IF EXISTS "Users can view their own feedback" ON feedback;
