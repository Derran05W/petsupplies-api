-- One-time setup: product image uploads (admin presigned URLs).
-- Run in Supabase SQL Editor for each environment (staging, production).
-- Bucket name must match SUPABASE_STORAGE_BUCKET (default: product-images).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read for storefront and admin previews.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'product_images_public_read'
  ) THEN
    CREATE POLICY product_images_public_read
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'product-images');
  END IF;
END $$;
