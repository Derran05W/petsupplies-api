import { prisma } from '../lib/prisma.js';
import { env } from '../types/env.js';
import type { AbandonedCartReminderEmailPayload } from './emailTemplates.js';
import * as cartService from './cartService.js';
import * as emailService from './emailService.js';
import * as subscriptionService from './subscriptionService.js';

export const JOB_BATCH_SIZE = 200;

export type JobName = 'abandoned-cart' | 'upcoming-delivery';

export interface JobResult {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export async function runAbandonedCartJob(nowInput?: Date): Promise<JobResult> {
  const started = Date.now();
  const now = nowInput ?? new Date();
  let scanned = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let cursor: string | undefined;

  while (scanned < JOB_BATCH_SIZE) {
    const batch = await cartService.findAbandonedCartCandidates({
      now,
      batchSize: JOB_BATCH_SIZE,
      cursor,
    });

    if (batch.length === 0) break;

    let lastProcessedId: string | undefined;

    for (const cart of batch) {
      if (scanned >= JOB_BATCH_SIZE) break;

      scanned += 1;
      lastProcessedId = cart.id;

      if (cart.items.length === 0) {
        skipped += 1;
        continue;
      }

      const prevStamp = cart.lastAbandonedEmailAt;

      try {
        const payload: AbandonedCartReminderEmailPayload = {
          cartId: cart.id,
          userId: cart.userId,
          to: cart.user.email,
          customerName: cart.user.name,
          items: cart.items.map((it) => ({
            productId: it.product.id,
            name: it.product.name,
            quantity: it.quantity,
            priceCents: it.product.price,
          })),
          cartUrl: `${env.FRONTEND_URL}/cart`,
          subtotalCents: cart.items.reduce((s, it) => s + it.quantity * it.product.price, 0),
          idempotencyRunAt: now,
        };

        const result = await emailService.sendAbandonedCartReminder(payload);
        if (result.ok) {
          sent += 1;
          const stamp = await prisma.cart.updateMany({
            where: {
              id: cart.id,
              lastAbandonedEmailAt: prevStamp,
            },
            data: { lastAbandonedEmailAt: now },
          });
          if (stamp.count === 0) {
            skipped += 1;
            console.info(
              JSON.stringify({
                op: 'runAbandonedCartJob',
                evt: 'abandoned_cart_stamp_lost_race',
                userId: cart.userId,
                cartId: cart.id,
              }),
            );
          }
        } else {
          failed += 1;
          console.warn(
            JSON.stringify({
              op: 'runAbandonedCartJob',
              evt: 'abandoned_cart_send_failed',
              userId: cart.userId,
              cartId: cart.id,
              code: result.error ?? 'SEND_FAILED',
            }),
          );
        }
      } catch (err) {
        failed += 1;
        const code = err instanceof Error ? err.name : 'EXCEPTION';
        console.warn(
          JSON.stringify({
            op: 'runAbandonedCartJob',
            evt: 'abandoned_cart_send_failed',
            userId: cart.userId,
            cartId: cart.id,
            code,
          }),
        );
      }
    }

    if (lastProcessedId !== undefined) {
      cursor = lastProcessedId;
    }

    if (scanned >= JOB_BATCH_SIZE) break;

    if (batch.length < JOB_BATCH_SIZE) break;
  }

  return {
    scanned,
    sent,
    failed,
    skipped,
    durationMs: Date.now() - started,
  };
}

export async function runUpcomingDeliveryJob(nowInput?: Date): Promise<JobResult> {
  const started = Date.now();
  const now = nowInput ?? new Date();
  const windowStartAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const windowEndAt = new Date(windowStartAt.getTime() + 60 * 60 * 1000);

  const r = await subscriptionService.sendUpcomingDeliveryRemindersDue({
    windowStartAt,
    windowEndAt,
  });

  return {
    scanned: r.scanned,
    sent: r.sent,
    failed: r.failed,
    skipped: r.skipped,
    durationMs: Date.now() - started,
  };
}
