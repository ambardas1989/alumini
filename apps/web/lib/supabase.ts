import { createClient } from '@supabase/supabase-js';

/**
 * Client-side Supabase instance — used only for uploading verification
 * documents directly to Storage (see app/verify/DocumentMethod.tsx).
 * Everything else in this app goes through lib/api.ts / the backend, not
 * this client directly — the backend never hands out a signed upload URL,
 * verification.service.ts's own header comment confirms the private
 * 'verification-documents' bucket is uploaded to directly by the caller,
 * then just the resulting storage path is POSTed to /verify/document.
 *
 * NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are empty in .env.local until a real
 * Supabase project is wired up (see that file's own comments) — createClient
 * doesn't throw on empty strings, but any actual upload will fail at
 * request time until they're set. DocumentMethod.tsx surfaces that as a
 * normal upload error rather than crashing the page.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

export const VERIFICATION_DOCUMENTS_BUCKET = 'verification-documents';

/** Public bucket — profile photos, unlike verification documents, are meant to be visible app-wide via a plain public URL. */
export const PROFILE_AVATARS_BUCKET = 'profile-avatars';

/** Public bucket — institution logos and classroom cover photos (TASKS_05 TASK 05). */
export const INSTITUTION_ASSETS_BUCKET = 'institution-assets';
