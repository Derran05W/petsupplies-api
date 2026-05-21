import { randomUUID } from 'crypto';
import { HTTPException } from 'hono/http-exception';
import { supabaseAdmin } from '../lib/supabase.js';
import { env } from '../types/env.js';

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function safeFilename(name: string): string {
  const lastDot = name.lastIndexOf('.');
  const ext =
    lastDot > 0
      ? name
          .slice(lastDot)
          .toLowerCase()
          .replace(/[^a-z0-9.]/g, '')
      : '';
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const safeBase =
    base
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'file';
  return `${safeBase}${ext}`;
}

async function createSignedUploadUrl(params: {
  filename: string;
  contentType: string;
  bucket: string;
  objectKeyPrefix: string;
  maxBytes: number;
}): Promise<{
  uploadUrl: string;
  token: string;
  objectKey: string;
  publicUrl: string;
  maxBytes: number;
}> {
  if (!ALLOWED_CONTENT_TYPES.has(params.contentType)) {
    throw new HTTPException(400, {
      message: `Unsupported content type "${params.contentType}". Allowed: jpeg, png, webp, gif`,
    });
  }

  const objectKey = `${params.objectKeyPrefix}/${randomUUID()}/${randomUUID()}-${safeFilename(params.filename)}`;

  const { data, error } = await supabaseAdmin.storage
    .from(params.bucket)
    .createSignedUploadUrl(objectKey);

  if (error || !data) {
    const detail = error?.message ?? 'Unknown error creating upload URL';
    const missingBucket = /does not exist|bucket not found/i.test(detail);
    throw new HTTPException(502, {
      message: missingBucket
        ? `Storage bucket "${params.bucket}" does not exist. Create a public bucket with that name in Supabase Dashboard → Storage (see docs/admin-products.md).`
        : `Storage error: ${detail}`,
    });
  }

  const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${params.bucket}/${objectKey}`;

  return {
    uploadUrl: data.signedUrl,
    token: data.token,
    objectKey,
    publicUrl,
    maxBytes: params.maxBytes,
  };
}

export async function createProductImageUploadUrl({
  filename,
  contentType,
}: {
  filename: string;
  contentType: string;
}) {
  return createSignedUploadUrl({
    filename,
    contentType,
    bucket: env.SUPABASE_STORAGE_BUCKET,
    objectKeyPrefix: 'products',
    maxBytes: env.SUPABASE_PRODUCT_IMAGE_MAX_BYTES,
  });
}

export async function createSiteAssetUploadUrl({
  filename,
  contentType,
}: {
  filename: string;
  contentType: string;
}) {
  return createSignedUploadUrl({
    filename,
    contentType,
    bucket: env.SUPABASE_SITE_ASSETS_BUCKET,
    objectKeyPrefix: 'site',
    maxBytes: env.SUPABASE_SITE_ASSET_MAX_BYTES,
  });
}
