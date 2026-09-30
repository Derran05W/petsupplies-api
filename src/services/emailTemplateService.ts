import type { EmailTemplate } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';
import {
  EMAIL_TEMPLATE_ALLOWED_VARS,
  EMAIL_TEMPLATE_KEYS,
  type EmailTemplateKey,
} from '../constants/emailTemplateDefaults.js';
import { prisma } from '../lib/prisma.js';
import type { EmailTemplateUpsertInput } from '../schemas/emailTemplate.js';
import { getEmailBrandContext } from './siteSettingsService.js';
import { revalidateFrontendTags } from './revalidationService.js';

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { row: EmailTemplate; expiresAt: number }>();

const VAR_PATTERN = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

export type EmailTemplateAdminSummary = {
  key: string;
  subject: string;
  preheader: string | null;
  updatedAt: string;
};

export type EmailTemplateAdminDetail = EmailTemplateAdminSummary & {
  bodyMarkdown: string;
};

function toSummary(row: EmailTemplate): EmailTemplateAdminSummary {
  return {
    key: row.key,
    subject: row.subject,
    preheader: row.preheader,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: EmailTemplate): EmailTemplateAdminDetail {
  return { ...toSummary(row), bodyMarkdown: row.bodyMarkdown };
}

export function assertEmailTemplateKey(key: string): EmailTemplateKey {
  if (!(EMAIL_TEMPLATE_KEYS as readonly string[]).includes(key)) {
    throw new HTTPException(400, { message: `Unknown email template key: ${key}` });
  }
  return key as EmailTemplateKey;
}

export function extractTemplateVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(VAR_PATTERN)) {
    const name = match[1];
    if (name) found.add(name);
  }
  return [...found];
}

export function validateTemplateVariables(template: string, key: EmailTemplateKey): void {
  const allowed = new Set(EMAIL_TEMPLATE_ALLOWED_VARS[key]);
  const used = extractTemplateVariables(template);
  const invalid = used.filter((v) => !allowed.has(v));
  if (invalid.length > 0) {
    throw new HTTPException(400, {
      message: `Invalid template variables for ${key}: ${invalid.join(', ')}`,
    });
  }
}

/**
 * Variable names whose value is a pre-built, already-safe HTML fragment
 * produced by our own rendering code (e.g. `lineItemsHtml()` /
 * `pet.line`'s `<p><strong>...` wrapper in emailTemplates.ts) rather than
 * free text. Only these may reach markdownToEmailHtml's raw-HTML
 * passthrough; every other substituted value is treated as untrusted free
 * text (see `neutralizeFreeTextForHtml`).
 */
const RAW_HTML_VARS = new Set(['lineItems', 'pet.line']);

/**
 * The raw-HTML passthrough in markdownToEmailHtml decides "is this block
 * raw HTML?" purely from whether the block's *text*, after substitution,
 * starts with `<tag`. A free-text value containing a blank-line run
 * (`\n\n`) can split itself out of its intended block and land in that
 * passthrough on its own — e.g. a user name of
 * `A\n\n<img src=x onerror=...>` becomes its own `<img ...>` "block".
 * Collapsing embedded blank lines keeps a substituted value confined to
 * the single block the template author placed it in, where the existing
 * per-block escaping in markdownToEmailHtml/formatInlineMarkdown already
 * applies — so this must NOT also HTML-entity-escape the value, or that
 * escaping would be applied twice.
 */
function neutralizeFreeTextForHtml(name: string, value: string): string {
  if (RAW_HTML_VARS.has(name)) return value;
  return value.replace(/\n+/g, ' ');
}

export function substituteTemplateVariables(
  template: string,
  vars: Record<string, string>,
  options: { forHtml?: boolean } = {},
): string {
  return template.replace(VAR_PATTERN, (_match, name: string) => {
    const value = vars[name] ?? '';
    return options.forHtml ? neutralizeFreeTextForHtml(name, value) : value;
  });
}

function invalidateCache(key?: string): void {
  if (key) {
    cache.delete(key);
    return;
  }
  cache.clear();
}

async function loadTemplateRow(key: EmailTemplateKey): Promise<EmailTemplate | null> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.row;
  }
  const row = await prisma.emailTemplate.findUnique({ where: { key } });
  if (row) {
    cache.set(key, { row, expiresAt: now + CACHE_TTL_MS });
  }
  return row;
}

const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** Allowlists link schemes to http/https/mailto; javascript:/data:/etc. are rejected. */
function isSafeLinkUrl(url: string): boolean {
  try {
    return SAFE_LINK_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function formatInlineMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
      if (!isSafeLinkUrl(url)) {
        // Unsafe/unparseable scheme (javascript:, data:, vbscript:, ...) — neutralize
        // by dropping the link and keeping the (escaped) label as plain text.
        return escapeHtml(label);
      }
      return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, (_m, inner: string) => `<strong>${escapeHtml(inner)}</strong>`);
}

/** Minimal markdown → HTML for transactional emails (paragraphs, bold, links, raw HTML blocks). */
export function markdownToEmailHtml(markdown: string): string {
  const blocks = markdown.split(/\n\n+/);
  const parts: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (/^<[\w]+[\s>]/.test(trimmed)) {
      parts.push(trimmed);
      continue;
    }

    const hasMarkdown = /\*\*[^*]+\*\*/.test(trimmed) || /\[[^\]]+\]\([^)]+\)/.test(trimmed);
    const html = hasMarkdown
      ? formatInlineMarkdown(trimmed).replace(/\n/g, '<br>')
      : escapeHtml(trimmed).replace(/\n/g, '<br>');
    parts.push(`<p>${html}</p>`);
  }

  return parts.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wrapEmailShell(bodyHtml: string, brandName: string, preheader: string | null): string {
  const preheaderHtml = preheader?.trim()
    ? `<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader.trim())}</span>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(brandName)}</title></head>
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
${preheaderHtml}
${bodyHtml}
</body>
</html>`;
}

export async function renderFromDbTemplate(
  key: EmailTemplateKey,
  vars: Record<string, string>,
): Promise<{ subject: string; html: string; text: string } | null> {
  const row = await loadTemplateRow(key);
  if (!row) return null;

  const brand = await getEmailBrandContext();
  const allVars = { 'brand.name': brand.brandName, ...vars };

  const subject = substituteTemplateVariables(row.subject, allVars);
  // HTML body: free-text values are neutralized (see neutralizeFreeTextForHtml) so a
  // malicious value can never fabricate a new markdown block and slip into
  // markdownToEmailHtml's raw-HTML passthrough branch.
  const bodyForHtml = substituteTemplateVariables(row.bodyMarkdown, allVars, { forHtml: true });
  const bodyHtml = markdownToEmailHtml(bodyForHtml);
  const html = wrapEmailShell(bodyHtml, brand.brandName, row.preheader);
  // Plain text carries values verbatim — a text/plain body has no HTML
  // block-passthrough to protect against.
  const bodyForText = substituteTemplateVariables(row.bodyMarkdown, allVars);

  return {
    subject,
    html,
    text: markdownToPlainText(bodyForText),
  };
}

export async function listAdminEmailTemplates(): Promise<EmailTemplateAdminSummary[]> {
  const rows = await prisma.emailTemplate.findMany({
    where: { key: { in: [...EMAIL_TEMPLATE_KEYS] } },
    orderBy: { key: 'asc' },
  });
  return rows.map(toSummary);
}

export async function getAdminEmailTemplate(key: string): Promise<EmailTemplateAdminDetail> {
  const allowed = assertEmailTemplateKey(key);
  const row = await prisma.emailTemplate.findUnique({ where: { key: allowed } });
  if (!row) {
    throw new HTTPException(404, { message: 'Email template not found' });
  }
  return toDetail(row);
}

export async function upsertEmailTemplate(
  key: string,
  input: EmailTemplateUpsertInput,
): Promise<EmailTemplateAdminDetail> {
  const allowed = assertEmailTemplateKey(key);
  validateTemplateVariables(input.subject, allowed);
  validateTemplateVariables(input.bodyMarkdown, allowed);
  if (input.preheader) {
    validateTemplateVariables(input.preheader, allowed);
  }

  const row = await prisma.emailTemplate.upsert({
    where: { key: allowed },
    create: {
      key: allowed,
      subject: input.subject,
      preheader: input.preheader ?? null,
      bodyMarkdown: input.bodyMarkdown,
    },
    update: {
      subject: input.subject,
      preheader: input.preheader ?? null,
      bodyMarkdown: input.bodyMarkdown,
    },
  });
  invalidateCache(allowed);
  await revalidateFrontendTags(['site-emails']);
  return toDetail(row);
}
