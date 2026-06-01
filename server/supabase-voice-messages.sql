-- LancsChat: Supabase Storage setup for voice messages
-- Run in Supabase Dashboard → SQL Editor (after creating project)

-- 1) Create the public bucket (or create "voice-messages" as Public in Storage UI)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'voice-messages',
  'voice-messages',
  true,
  5242880,
  ARRAY['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2) Policies — users upload only into their own folder (userId/filename)
DROP POLICY IF EXISTS "voice_messages_public_read" ON storage.objects;
DROP POLICY IF EXISTS "voice_messages_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "voice_messages_auth_delete" ON storage.objects;

CREATE POLICY "voice_messages_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'voice-messages');

CREATE POLICY "voice_messages_auth_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'voice-messages'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "voice_messages_auth_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'voice-messages'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
