import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(),
    },
  },
}));

import { supabaseAdmin } from '../../src/lib/supabase.js';
import * as storageService from '../../src/services/storageService.js';

function mockBucketWith(result: { data?: unknown; error?: unknown }) {
  const createSignedUploadUrl = vi.fn().mockResolvedValue(result);
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({
    createSignedUploadUrl,
  } as never);
  return createSignedUploadUrl;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_STORAGE_BUCKET = 'product-images';
  process.env.SUPABASE_PRODUCT_IMAGE_MAX_BYTES = '5000000';
});

describe('storageService.createProductImageUploadUrl', () => {
  it('rejects unsupported content types with 400', async () => {
    await expect(
      storageService.createProductImageUploadUrl({
        filename: 'photo.bmp',
        contentType: 'image/bmp',
      }),
    ).rejects.toThrow(HTTPException);
  });

  it('accepts image/jpeg', async () => {
    mockBucketWith({
      data: { signedUrl: 'https://storage.example.com/upload', token: 'tok-1' },
      error: null,
    });

    const result = await storageService.createProductImageUploadUrl({
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
    });

    expect(result.uploadUrl).toBe('https://storage.example.com/upload');
    expect(result.token).toBe('tok-1');
    expect(result.maxBytes).toBe(5_000_000);
  });

  it('accepts image/png', async () => {
    mockBucketWith({
      data: { signedUrl: 'https://storage.example.com/upload', token: 'tok-2' },
      error: null,
    });

    const result = await storageService.createProductImageUploadUrl({
      filename: 'photo.png',
      contentType: 'image/png',
    });

    expect(result.uploadUrl).toBeDefined();
  });

  it('accepts image/webp', async () => {
    mockBucketWith({
      data: { signedUrl: 'https://storage.example.com/upload', token: 'tok-3' },
      error: null,
    });

    const result = await storageService.createProductImageUploadUrl({
      filename: 'photo.webp',
      contentType: 'image/webp',
    });

    expect(result.uploadUrl).toBeDefined();
  });

  it('accepts image/gif', async () => {
    mockBucketWith({
      data: { signedUrl: 'https://storage.example.com/upload', token: 'tok-4' },
      error: null,
    });

    const result = await storageService.createProductImageUploadUrl({
      filename: 'photo.gif',
      contentType: 'image/gif',
    });

    expect(result.uploadUrl).toBeDefined();
  });

  it('generates objectKey under products/ prefix', async () => {
    const spy = mockBucketWith({
      data: { signedUrl: 'https://upload.example.com', token: 't' },
      error: null,
    });

    const result = await storageService.createProductImageUploadUrl({
      filename: 'my photo.jpg',
      contentType: 'image/jpeg',
    });

    expect(result.objectKey).toMatch(/^products\/.+\/.+-my-photo\.jpg$/);
    const calledKey = spy.mock.calls[0][0] as string;
    expect(calledKey).toBe(result.objectKey);
  });

  it('returns publicUrl containing the objectKey', async () => {
    mockBucketWith({
      data: { signedUrl: 'https://upload.example.com', token: 't' },
      error: null,
    });

    const result = await storageService.createProductImageUploadUrl({
      filename: 'img.jpg',
      contentType: 'image/jpeg',
    });

    expect(result.publicUrl).toContain(result.objectKey);
    expect(result.publicUrl).toContain('product-images');
  });

  it('throws 502 when Supabase returns an error', async () => {
    mockBucketWith({
      data: null,
      error: { message: 'Bucket not found' },
    });

    await expect(
      storageService.createProductImageUploadUrl({
        filename: 'img.jpg',
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow(HTTPException);
  });

  it('sanitizes unsafe characters in filename', async () => {
    const spy = mockBucketWith({
      data: { signedUrl: 'https://upload.example.com', token: 't' },
      error: null,
    });

    await storageService.createProductImageUploadUrl({
      filename: '../../../etc/passwd.jpg',
      contentType: 'image/jpeg',
    });

    const calledKey = spy.mock.calls[0][0] as string;
    expect(calledKey).not.toContain('..');
    expect(calledKey).not.toContain('/etc/');
  });
});

describe('storageService.createSiteAssetUploadUrl', () => {
  beforeEach(() => {
    process.env.SUPABASE_SITE_ASSETS_BUCKET = 'site-assets';
    process.env.SUPABASE_SITE_ASSET_MAX_BYTES = '5000000';
  });

  it('rejects unsupported content types with 400', async () => {
    await expect(
      storageService.createSiteAssetUploadUrl({
        filename: 'photo.bmp',
        contentType: 'image/bmp',
      }),
    ).rejects.toThrow(HTTPException);
  });

  it('generates objectKey under site/ prefix', async () => {
    mockBucketWith({
      data: { signedUrl: 'https://storage.example.com/upload', token: 'tok-1' },
      error: null,
    });

    const result = await storageService.createSiteAssetUploadUrl({
      filename: 'hero.jpg',
      contentType: 'image/jpeg',
    });

    expect(result.objectKey).toMatch(/^site\/.+\/.+-hero\.jpg$/);
    expect(result.publicUrl).toContain('site-assets');
  });
});
