import { Resend } from 'resend';
import { env } from '../types/env.js';

export type EmailSendTag = { name: string; value: string };

export type SendEmailInput = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  tags?: EmailSendTag[];
  /** Used for no-op / dev skip debug logs only (no bodies or recipient). */
  noopLog?: { template: string; correlationId?: string };
};

export const EMAIL_TRANSPORT_NOOP_MESSAGE_ID = 'email-transport-noop';

export type SendEmailResult = { id?: string; skipped?: boolean };

const globalForEmail = globalThis as unknown as {
  resend?: Resend;
};

function getResend(): Resend | null {
  if (env.NODE_ENV === 'test') {
    return null;
  }
  if (env.NODE_ENV === 'development' && !env.RESEND_API_KEY?.trim()) {
    return null;
  }
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    return null;
  }
  return (globalForEmail.resend ??= new Resend(key));
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const client = getResend();
  if (!client) {
    const { template, correlationId } = input.noopLog ?? { template: 'unknown' };
    if (env.NODE_ENV === 'test') {
      console.debug('[email] transport skipped', { template, correlationId });
    } else {
      console.log('[email] transport skipped (no Resend client)', { template, correlationId });
    }
    return { id: EMAIL_TRANSPORT_NOOP_MESSAGE_ID, skipped: true };
  }

  const { data, error } = await client.emails.send(
    {
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      tags: input.tags,
    },
    { idempotencyKey: input.idempotencyKey },
  );

  if (error) {
    throw new Error(error.message);
  }

  return { id: data?.id };
}
