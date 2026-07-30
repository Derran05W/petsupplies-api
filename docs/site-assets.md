# Site assets storage (`site-assets` bucket)

Homepage hero images and other merchant-uploaded site assets use a dedicated Supabase Storage bucket, separate from `product-images`.

## Bucket setup (Supabase dashboard)

**Option A — SQL (recommended):** In Supabase **SQL Editor**, run [`supabase/storage/site-assets-bucket.sql`](../supabase/storage/site-assets-bucket.sql). This creates the `site-assets` public bucket (with the file-size limit + image MIME allowlist) and the public-read policy in one step — then continue with the admin-write RLS policies in step 3 below.

1. Create a bucket named `site-assets` (or set `SUPABASE_SITE_ASSETS_BUCKET` to your bucket name).
2. Enable **public read** for the bucket so the storefront can render `heroImageUrl` and other public URLs.
3. Apply RLS policies so only admins can write:

```sql
-- Allow public read
CREATE POLICY "site_assets_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'site-assets');

-- Admin-only insert
CREATE POLICY "site_assets_admin_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'site-assets'
  AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
);

-- Admin-only update
CREATE POLICY "site_assets_admin_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'site-assets'
  AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
);

-- Admin-only delete
CREATE POLICY "site_assets_admin_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'site-assets'
  AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
);
```

Adjust `bucket_id` if you use a non-default bucket name.

## API upload flow

1. Admin calls `POST /admin/site/assets/upload-url` with `{ filename, contentType }` (jpeg, png, webp, gif).
2. API returns `{ uploadUrl, token, objectKey, publicUrl, maxBytes }` (same shape as product images).
3. Admin client `PUT`s the file to `uploadUrl`.
4. Admin saves `publicUrl` (or a site-relative path) via `PATCH /admin/site/settings` on `heroImageUrl`.

Object keys are stored under the `site/` prefix inside the bucket.

## Environment

| Variable                        | Default       | Purpose                  |
| ------------------------------- | ------------- | ------------------------ |
| `SUPABASE_SITE_ASSETS_BUCKET`   | `site-assets` | Bucket name              |
| `SUPABASE_SITE_ASSET_MAX_BYTES` | `5000000`     | Max upload size per file |

See also [`docs/api-endpoints.md`](./api-endpoints.md) for route list and [`docs/deployment.md`](./deployment.md) for Railway env setup.
