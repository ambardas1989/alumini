-- Storage bucket policies for profile avatars and institution assets
-- Run manually in the Supabase SQL Editor — this repo's migrations are
-- not auto-applied on deploy (see supabase/migrations/README.md).
-- Safe to run multiple times (DROP IF EXISTS before CREATE).
--
-- NOTE: Buckets must be created manually in the Supabase Storage
-- dashboard before running this migration — bucket creation cannot be
-- done via SQL:
--   - profile-avatars (public, 5MB limit)
--   - institution-assets (public, 10MB limit)
--
-- IMPORTANT — see TASKS_07 TASK 01/TASK 11's own notes: this app issues
-- its own NestJS JWTs, never a real Supabase Auth session, so auth.uid()
-- is always NULL for a request made with the anon-key client — every
-- auth.uid()-keyed policy below (avatar_upload/avatar_update/
-- avatar_delete) can never actually pass for THIS app's frontend as a
-- result, regardless of being applied correctly. They're still included
-- here exactly as specified — a direct anon-key upload path may exist in
-- other clients/future work, and avatar_read/institution_assets_read
-- (public SELECT) are unaffected by this since they don't check auth.uid()
-- at all. TASK 11 routes actual uploads through the backend's
-- service-role client instead, which bypasses RLS entirely and is
-- unaffected by any policy in this file.

-- profile-avatars bucket policies
DROP POLICY IF EXISTS "avatar_upload" ON storage.objects;
CREATE POLICY "avatar_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[1] = 'profiles'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "avatar_read" ON storage.objects;
CREATE POLICY "avatar_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'profile-avatars');

DROP POLICY IF EXISTS "avatar_update" ON storage.objects;
CREATE POLICY "avatar_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "avatar_delete" ON storage.objects;
CREATE POLICY "avatar_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- institution-assets bucket policies
DROP POLICY IF EXISTS "institution_assets_upload" ON storage.objects;
CREATE POLICY "institution_assets_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'institution-assets');

DROP POLICY IF EXISTS "institution_assets_read" ON storage.objects;
CREATE POLICY "institution_assets_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'institution-assets');
