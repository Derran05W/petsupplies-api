import { randomUUID } from 'crypto';
import { HTTPException } from 'hono/http-exception';
import { supabaseAdmin } from '../lib/supabase.js';
import { env } from '../types/env.js';

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function safeFilename(name: string): string {
  // Extract extension before sanitising so dots within path segments are stripped
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

export async function createProductImageUploadUrl({
  filename,
  contentType,
}: {
  filename: string;
  contentType: string;
}): Promise<{
  uploadUrl: string;
  token: string;
  objectKey: string;
  publicUrl: string;
  maxBytes: number;
}> {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new HTTPException(400, {
      message: `Unsupported content type "${contentType}". Allowed: jpeg, png, webp, gif`,
    });
  }

  const objectKey = `products/${randomUUID()}/${randomUUID()}-${safeFilename(filename)}`;
  const bucket = env.SUPABASE_STORAGE_BUCKET;

  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(objectKey);

  if (error || !data) {
    throw new HTTPException(502, {
      message: `Storage error: ${error?.message ?? 'Unknown error creating upload URL'}`,
    });
  }

  const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectKey}`;

  return {
    uploadUrl: data.signedUrl,
    token: data.token,
    objectKey,
    publicUrl,
    maxBytes: env.SUPABASE_PRODUCT_IMAGE_MAX_BYTES,
  };
}
