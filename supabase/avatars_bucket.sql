-- LancsChat: Supabase Storage bucket + policies for profile pictures
-- Bucket: avatars
-- Goals:
-- 1) Public read access
-- 2) Authenticated users can write ONLY within their own folder: {userId}/...

-- Create bucket (id + name are typically the same)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update
set public = true;

-- Public read for avatars
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read avatars'
  ) THEN
    CREATE POLICY "Public read avatars"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'avatars');
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    NULL;
END $$;

-- Authenticated users can upload into their own folder (first path segment == auth.uid())
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'User can upload own avatar'
  ) THEN
    CREATE POLICY "User can upload own avatar"
    ON storage.objects
    FOR INSERT
    WITH CHECK (
      bucket_id = 'avatars'
      AND auth.uid() IS NOT NULL
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    NULL;
END $$;

-- Authenticated users can update objects only in their own folder
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'User can update own avatar'
  ) THEN
    CREATE POLICY "User can update own avatar"
    ON storage.objects
    FOR UPDATE
    USING (
      bucket_id = 'avatars'
      AND auth.uid() IS NOT NULL
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
      bucket_id = 'avatars'
      AND auth.uid() IS NOT NULL
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    NULL;
END $$;

-- Authenticated users can delete objects only in their own folder
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'User can delete own avatar'
  ) THEN
    CREATE POLICY "User can delete own avatar"
    ON storage.objects
    FOR DELETE
    USING (
      bucket_id = 'avatars'
      AND auth.uid() IS NOT NULL
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    NULL;
END $$;
