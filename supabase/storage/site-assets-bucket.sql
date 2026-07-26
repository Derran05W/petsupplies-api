-- One-time setup: site asset uploads (homepage hero / self-serve site assets, admin presigned URLs).
-- Run in Supabase SQL Editor for each environment (staging, production).
-- Bucket name must match SUPABASE_SITE_ASSETS_BUCKET (default: site-assets).
-- See docs/site-assets.md for the full bucket setup + RLS write-policy reference.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'site-assets',
  'site-assets',
  true,
  5000000,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read for storefront (heroImageUrl and other public site-asset URLs) and admin previews.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'site_assets_public_read'
  ) THEN
    CREATE POLICY site_assets_public_read
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'site-assets');
  END IF;
END $$;
