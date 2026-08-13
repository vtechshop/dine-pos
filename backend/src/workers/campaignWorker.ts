/**
 * Campaign Scheduler Worker
 *
 * Runs every minute (via scheduler.ts) to dispatch campaigns whose scheduledAt
 * has passed.
 *
 * Crash-safety: the atomic lock transitions the campaign to 'failed' (not 'sent')
 * before the provider call. This means a crash between the lock and the final
 * status update leaves the campaign in 'failed' — recoverable by re-scheduling —
 * rather than stuck in a false 'sent' state.
 *
 * When a real WhatsApp/SMS provider is wired in, configure it in
 * src/services/messagingProvider.ts. No other file needs to change.
 */

import mongoose from 'mongoose';
import Campaign from '../models/Campaign';
import CustomerProfile from '../models/CustomerProfile';
import { getMessagingProvider } from '../services/messagingProvider';
import { logger } from '../utils/logger';

// ── Audience resolver (mirrors campaignRoutes; adds phone/consent filter) ─────

async function resolveRecipients(
  hotelObjId:     mongoose.Types.ObjectId,
  audience:       string,
  customAudience: mongoose.Types.ObjectId[],
): Promise<{ phone: string; name: string }[]> {
  const base: Record<string, any> = {
    hotelId:        hotelObjId,
    status:         'active',
    marketingOptIn: true,
    phone:          { $ne: null },
  };

  if (audience === 'custom') {
    const customers = await CustomerProfile.find({
      ...base,
      _id: { $in: customAudience },
    }).select('name phone').lean();
    return customers.map(c => ({ phone: c.phone as string, name: c.name }));
  }

  const filter: Record<string, any> = { ...base };
  const now = new Date();
  const mm  = String(now.getMonth() + 1).padStart(2, '0');

  function nextSevenDayPatterns(): string[] {
    const patterns: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d   = new Date(now);
      d.setDate(d.getDate() + i);
      const m   = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      patterns.push(`${m}-${day}`);
    }
    return patterns;
  }

  switch (audience) {
    case 'new':          filter.visitCount     = 1; break;
    case 'repeat':       filter.visitCount     = { $gte: 2 }; break;
    case 'vip':          filter.lifetimeSpend  = { $gt: 0 }; break;
    case 'inactive30':
      filter.lastVisitAt = { $lt: new Date(Date.now() - 30 * 86400000), $ne: null };
      filter.visitCount  = { $gt: 0 };
      break;
    case 'inactive60':
      filter.lastVisitAt = { $lt: new Date(Date.now() - 60 * 86400000), $ne: null };
      filter.visitCount  = { $gt: 0 };
      break;
    case 'inactive90':
      filter.lastVisitAt = { $lt: new Date(Date.now() - 90 * 86400000), $ne: null };
      filter.visitCount  = { $gt: 0 };
      break;
    case 'birthday':        filter.birthday    = { $regex: `^${mm}-`, $ne: null }; break;
    case 'anniversary':     filter.anniversary = { $regex: `^${mm}-`, $ne: null }; break;
    case 'birthdayweek':    filter.birthday    = { $in: nextSevenDayPatterns(), $ne: null }; break;
    case 'anniversaryweek': filter.anniversary = { $in: nextSevenDayPatterns(), $ne: null }; break;
    case 'loyalty':         filter.loyaltyBalance = { $gt: 0 }; break;
    case 'noloyalty':
      filter.loyaltyBalance = 0;
      filter.visitCount     = { $gt: 0 };
      break;
    // 'all' — no extra filter beyond base
  }

  const customers = await CustomerProfile.find(filter).select('name phone').lean();
  return customers.map(c => ({ phone: c.phone as string, name: c.name }));
}

// ── Template variable resolution ──────────────────────────────────────────────

function renderMessage(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

// ── Main dispatch function (called by scheduler every 60s) ────────────────────

export async function dispatchScheduledCampaigns(): Promise<void> {
  try {
    const now = new Date();

    const pending = await Campaign.find({
      status:      'scheduled',
      scheduledAt: { $lte: now },
    }).lean();

    if (pending.length === 0) return;

    logger.info(`[campaignWorker] ${pending.length} scheduled campaign(s) to dispatch`);

    for (const campaign of pending) {
      try {
        // Atomic claim: lock by transitioning to 'failed'.
        // If this process crashes before the final update, the campaign remains
        // in 'failed' (not stuck as 'sent'), which an operator can re-schedule.
        const locked = await Campaign.findOneAndUpdate(
          { _id: campaign._id, status: 'scheduled' },
          { $set: { status: 'failed', failureReason: 'Dispatch in progress' } },
          { new: false },
        );
        if (!locked) continue; // Another instance already claimed it

        const provider = getMessagingProvider(campaign.channel);

        // Resolve opted-in recipients fresh at dispatch time
        const recipients = await resolveRecipients(
          campaign.hotelId as mongoose.Types.ObjectId,
          campaign.audience,
          campaign.customAudience as mongoose.Types.ObjectId[],
        );

        if (recipients.length === 0) {
          await Campaign.findByIdAndUpdate(campaign._id, {
            status:        'failed',
            failureReason: 'No eligible opted-in recipients found at send time',
          });
          logger.info(`[campaignWorker] campaign ${String(campaign._id)}: 0 eligible recipients`);
          continue;
        }

        // Server-side variable substitution
        const messages = recipients.map(r => ({
          phone:      r.phone,
          message:    renderMessage(campaign.messageTemplate, {
            name:  r.name,
            hotel: campaign.hotelId.toString(),
          }),
          customerId: undefined,
        }));

        const result = await provider.sendMessages(String(campaign._id), campaign.channel, messages);

        if (result.status === 'sent') {
          await Campaign.findByIdAndUpdate(campaign._id, {
            status:         'sent',
            sentAt:         now,
            failureReason:  '',
            recipientCount: result.sentCount,
          });
          logger.info(`[campaignWorker] campaign ${String(campaign._id)}: sent (${result.sentCount}/${recipients.length})`);
        } else {
          await Campaign.findByIdAndUpdate(campaign._id, {
            status:         'failed',
            failureReason:  result.reason ?? (result.status === 'no_provider' ? 'No provider configured' : 'Provider error'),
            recipientCount: recipients.length,
          });
          logger.info(`[campaignWorker] campaign ${String(campaign._id)}: ${result.status}`);
        }
      } catch (err) {
        logger.error(`[campaignWorker] error dispatching campaign ${String(campaign._id)}`, { err: String(err) });
        await Campaign.findByIdAndUpdate(campaign._id, {
          status:        'failed',
          failureReason: String(err).slice(0, 500),
        }).catch(() => {});
      }
    }
  } catch (err) {
    logger.error('[campaignWorker] dispatchScheduledCampaigns error', { err: String(err) });
  }
}
