import { env } from '../types/env.js';

export async function revalidateFrontendTags(tags: string[]): Promise<void> {
  const token = env.INTERNAL_REVALIDATE_TOKEN?.trim();
  if (!token) {
    console.debug('[revalidate] skipped — INTERNAL_REVALIDATE_TOKEN not set', { tags });
    return;
  }

  const url = `${env.FRONTEND_URL}/api/internal/revalidate`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) {
      console.warn('[revalidate] non-OK response', {
        tags,
        status: res.status,
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.warn('[revalidate] request failed', { tags, error: message });
  }
}
