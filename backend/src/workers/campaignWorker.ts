/**
 * Campaign Scheduler Worker
 *
 * Runs every minute (via scheduler.ts) to dispatch campaigns whose scheduledAt
 * has passed. Since no provider is integrated, scheduled campaigns that fire
 * with no provider are marked 'failed' with an explicit reason.
 *
 * When a real WhatsApp/SMS provider is wired in, the provider call goes in
 * the `sendCampaignMessages` stub below.
 */

import mongoose from 'mongoose';
import Campaign from '../models/Campaign';
import CustomerProfile from '../models/CustomerProfile';
import { logger } from '../utils/logger';

// ── Provider interface (stub until real provider configured) ──────────────────

interface ProviderResult {
  status: 'no_provider' | 'sent' | 'failed';
  sentCount: number;
  failedCount: number;
  reason?: string;
}

async function sendCampaignMessages(
  _campaignId: string,
  _channel:   'whatsapp' | 'sms',
  _recipients: { phone: string; message: string }[],
): Promise<ProviderResult> {
  // No provider configured. Replace this function with real provider logic
  // (MSG91, WhatsApp Business Cloud API, etc.) when available.
  return {
    status:      'no_provider',
    sentCount:   0,
    failedCount: _recipients.length,
    reason:      'No WhatsApp/SMS provider configured. Configure a provider in Settings → Integrations.',
  };
}

// ── Audience resolver (mirrors campaignRoutes but adds phone select) ──────────

async function resolveRecipients(
  hotelObjId: mongoose.Types.ObjectId,
  audience:   string,
  customAudience: mongoose.Types.ObjectId[],
): Promise<{ phone: string; name: string }[]> {
  if (audience === 'custom') {
    const customers = await CustomerProfile.find({
      _id:           { $in: customAudience },
      hotelId:       hotelObjId,
      status:        'active',
      marketingOptIn: true,
      phone:          { $ne: null },
    }).select('name phone').lean();
    return customers.map(c => ({ phone: c.phone as string, name: c.name }));
  }

  const filter: Record<string, any> = {
    hotelId:        hotelObjId,
    status:         'active',
    marketingOptIn: true,
    phone:          { $ne: null },
  };

  const now = new Date();
  const mm  = String(now.getMonth() + 1).padStart(2, '0');

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
    case 'birthday':    filter.birthday    = { $regex: `^${mm}-`, $ne: null }; break;
    case 'anniversary': filter.anniversary = { $regex: `^${mm}-`, $ne: null }; break;
    case 'loyalty':     filter.loyaltyBalance = { $gt: 0 }; break;
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

    // Find campaigns scheduled to fire now or in the past
    const pending = await Campaign.find({
      status:      'scheduled',
      scheduledAt: { $lte: now },
    }).lean();

    if (pending.length === 0) return;

    logger.info(`[campaignWorker] ${pending.length} scheduled campaign(s) to dispatch`);

    for (const campaign of pending) {
      try {
        // Mark as 'sending' to prevent duplicate dispatch if loop runs again
        const locked = await Campaign.findOneAndUpdate(
          { _id: campaign._id, status: 'scheduled' },
          { $set: { status: 'sent', sentAt: now } },
          { new: false },
        );
        if (!locked) continue; // Another instance already dispatched

        // Resolve opted-in recipients
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

        // Build messages (server-side variable substitution)
        const messages = recipients.map(r => ({
          phone:   r.phone,
          message: renderMessage(campaign.messageTemplate, {
            name:  r.name,
            hotel: campaign.hotelId.toString(), // replaced by hotel name if hotel lookup added
          }),
        }));

        const result = await sendCampaignMessages(
          String(campaign._id),
          campaign.channel,
          messages,
        );

        if (result.status === 'no_provider') {
          await Campaign.findByIdAndUpdate(campaign._id, {
            status:         'failed',
            failureReason:  result.reason ?? 'No provider configured',
            recipientCount: recipients.length,
          });
          logger.info(`[campaignWorker] campaign ${String(campaign._id)}: no_provider`);
        } else {
          await Campaign.findByIdAndUpdate(campaign._id, {
            status:         result.status === 'sent' ? 'sent' : 'failed',
            failureReason:  result.reason ?? '',
            recipientCount: result.sentCount,
          });
          logger.info(`[campaignWorker] campaign ${String(campaign._id)}: ${result.status} (${result.sentCount} sent)`);
        }
      } catch (err) {
        logger.error(`[campaignWorker] error dispatching campaign ${String(campaign._id)}`, { err: String(err) });
        await Campaign.findByIdAndUpdate(campaign._id, {
          status:       'failed',
          failureReason: String(err).slice(0, 500),
        }).catch(() => {});
      }
    }
  } catch (err) {
    logger.error('[campaignWorker] dispatchScheduledCampaigns error', { err: String(err) });
  }
}
