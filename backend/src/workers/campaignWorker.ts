/**
 * Campaign Scheduler Worker + Dispatch Engine
 *
 * dispatchScheduledCampaigns() — called by scheduler.ts every 60s.
 *   Picks up campaigns with status='scheduled' whose scheduledAt has passed.
 *   Atomically locks each campaign to 'failed' for crash safety: if the
 *   process dies between lock and final update, the campaign stays 'failed'
 *   (recoverable by re-scheduling) rather than stuck in a false 'sent' state.
 *
 * dispatchCampaignById(campaignId, hotelId) — exported for the manual send route.
 *   Called after the route has already locked the campaign to 'sending'.
 *   Resolves recipients, calls the provider, writes CampaignMessage records,
 *   and updates campaign to 'sent' / 'partial' / 'failed'.
 *
 * _doCampaignDispatch(campaign, provider, hotelObjId) — internal shared core.
 *   Both entry points converge here after locking and provider resolution.
 *
 * Security invariants:
 *  - marketingOptIn:true and status:'active' enforced in resolveRecipients
 *  - getMessagingProvider() is hotel-scoped — credentials never cross hotels
 *  - CampaignMessage records include hotelId for cross-tenant isolation
 *  - Dispatch is idempotent: unique index on { campaignId, phone } prevents
 *    double-insertion; ordered:false on insertMany lets partial succeeds through
 */

import mongoose from 'mongoose';
import Campaign from '../models/Campaign';
import CampaignMessage from '../models/CampaignMessage';
import CustomerProfile from '../models/CustomerProfile';
import Hotel from '../models/Hotel';
import { getMessagingProvider } from '../services/messagingProvider';
import type { MessageRecipient, MessagingProvider, WaTemplateOptions } from '../services/messagingProvider';
import { logger } from '../utils/logger';

// ── Recipient resolver (enforces consent + active status at send time) ────────

interface Recipient {
  phone:          string;
  name:           string;
  loyaltyBalance: number;
  customerId:     string;
}

async function resolveRecipients(
  hotelObjId:     mongoose.Types.ObjectId,
  audience:       string,
  customAudience: mongoose.Types.ObjectId[],
): Promise<Recipient[]> {
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
    }).select('name phone loyaltyBalance').lean();
    return customers.map(c => ({
      phone:          c.phone as string,
      name:           c.name,
      loyaltyBalance: c.loyaltyBalance ?? 0,
      customerId:     String(c._id),
    }));
  }

  const filter: Record<string, any> = { ...base };
  const now = new Date();
  const mm  = String(now.getMonth() + 1).padStart(2, '0');

  function nextSevenDayPatterns(): string[] {
    const patterns: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const m   = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      patterns.push(`${m}-${day}`);
    }
    return patterns;
  }

  switch (audience) {
    case 'new':     filter.visitCount    = 1;           break;
    case 'repeat':  filter.visitCount    = { $gte: 2 }; break;
    case 'vip':     filter.lifetimeSpend = { $gt: 0 };  break;
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
    case 'birthday':
      filter.birthday = { $regex: `^${mm}-`, $ne: null }; break;
    case 'anniversary':
      filter.anniversary = { $regex: `^${mm}-`, $ne: null }; break;
    case 'birthdayweek':
      filter.birthday = { $in: nextSevenDayPatterns(), $ne: null }; break;
    case 'anniversaryweek':
      filter.anniversary = { $in: nextSevenDayPatterns(), $ne: null }; break;
    case 'loyalty':
      filter.loyaltyBalance = { $gt: 0 }; break;
    case 'noloyalty':
      filter.loyaltyBalance = 0;
      filter.visitCount     = { $gt: 0 };
      break;
    // 'all' — no extra filter beyond base
  }

  const customers = await CustomerProfile.find(filter).select('name phone loyaltyBalance').lean();
  return customers.map(c => ({
    phone:          c.phone as string,
    name:           c.name,
    loyaltyBalance: c.loyaltyBalance ?? 0,
    customerId:     String(c._id),
  }));
}

// ── Template variable resolution ──────────────────────────────────────────────

function renderMessage(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

// ── Core dispatch (shared by scheduled worker and manual send route) ──────────

async function _doCampaignDispatch(
  campaign:    any,             // lean ICampaign document
  provider:    MessagingProvider,
  hotelObjId:  mongoose.Types.ObjectId,
): Promise<void> {
  const campaignObjId = campaign._id as mongoose.Types.ObjectId;
  const campaignId    = String(campaignObjId);

  // WhatsApp campaigns must have a pre-approved Meta template name
  if (campaign.channel === 'whatsapp' && !campaign.waTemplateName) {
    await Campaign.findByIdAndUpdate(campaignObjId, {
      status:        'failed',
      failureReason: 'WhatsApp campaigns require a pre-approved template name. Edit the campaign to add one.',
      sentCount:     0,
      failedCount:   0,
    });
    logger.info(`[campaignWorker] campaign ${campaignId}: failed — no waTemplateName`);
    return;
  }

  // Fetch hotel name for {hotel} template variable
  const hotelDoc  = await Hotel.findById(campaign.hotelId).select('hotelName').lean();
  const hotelName = (hotelDoc as any)?.hotelName ?? 'our restaurant';

  // Resolve opted-in active recipients at dispatch time
  const recipients = await resolveRecipients(
    hotelObjId,
    campaign.audience,
    campaign.customAudience as mongoose.Types.ObjectId[],
  );

  if (recipients.length === 0) {
    await Campaign.findByIdAndUpdate(campaignObjId, {
      status:        'failed',
      failureReason: 'No eligible opted-in recipients found at send time',
      sentCount:     0,
      failedCount:   0,
    });
    logger.info(`[campaignWorker] campaign ${campaignId}: failed — 0 eligible recipients`);
    return;
  }

  // Build WA template options (undefined for SMS — provider ignores it)
  const waTemplate: WaTemplateOptions | undefined = campaign.channel === 'whatsapp'
    ? {
        templateName:      campaign.waTemplateName as string,
        templateLanguage:  campaign.waTemplateLanguage  || 'en',
        templateNamespace: campaign.waTemplateNamespace || '',
        templateVars:      (campaign.waTemplateVars as string[]) || [],
      }
    : undefined;

  // Build per-recipient message list with rendered SMS text and WA vars
  const messages: MessageRecipient[] = recipients.map(r => {
    const vars = {
      name:   r.name,
      hotel:  hotelName,
      points: String(r.loyaltyBalance),
    };
    return {
      phone:      r.phone,
      message:    renderMessage(campaign.messageTemplate, vars),
      customerId: r.customerId,
      vars,
    };
  });

  const now = new Date();
  const result = await provider.sendMessages(campaignId, campaign.channel, messages, waTemplate);

  // Write per-recipient delivery tracking records
  if (result.recipients.length > 0) {
    const messageDocs = result.recipients.map(r => ({
      campaignId:        campaignObjId,
      hotelId:           hotelObjId,
      customerId:        r.customerId ? new mongoose.Types.ObjectId(r.customerId) : null,
      phone:             r.phone,
      channel:           campaign.channel  as 'whatsapp' | 'sms',
      provider:          provider.name     as 'msg91'    | 'none',
      requestId:         r.requestId       ?? null,
      providerMessageId: null,
      status:            r.status,
      failureReason:     r.failureReason   ?? '',
      queuedAt:          now,
      sentAt:            r.status === 'sent'   ? now : null,
      deliveredAt:       null,
      readAt:            null,
      failedAt:          r.status === 'failed' ? now : null,
    }));

    await CampaignMessage.insertMany(messageDocs, { ordered: false }).catch(err => {
      // Ignore E11000 duplicate key errors — occur on retry when records already exist
      logger.warn(`[campaignWorker] CampaignMessage.insertMany partial failure for ${campaignId}`, {
        err: String(err),
      });
    });
  }

  // Final campaign status
  const finalStatus =
    result.status === 'sent'    ? 'sent'    :
    result.status === 'partial' ? 'partial' : 'failed';

  await Campaign.findByIdAndUpdate(campaignObjId, {
    status:        finalStatus,
    sentAt:        finalStatus !== 'failed' ? now : undefined,
    failureReason: result.status === 'failed' ? (result.reason ?? 'Provider error') : '',
    sentCount:     result.sentCount,
    failedCount:   result.failedCount,
  });

  logger.info(
    `[campaignWorker] campaign ${campaignId}: ${finalStatus} ` +
    `(sent=${result.sentCount}, failed=${result.failedCount})`,
  );
}

// ── Public: manual send entry point (called by campaign route's /:id/send) ───

export async function dispatchCampaignById(
  campaignId: string,
  hotelId:    string,
): Promise<void> {
  const hotelObjId   = new mongoose.Types.ObjectId(hotelId);
  const campaignObjId = new mongoose.Types.ObjectId(campaignId);

  const campaign = await Campaign.findOne({
    _id:     campaignObjId,
    hotelId: hotelObjId,
  }).lean();

  if (!campaign) {
    logger.error(`[campaignWorker] dispatchCampaignById: campaign ${campaignId} not found`);
    return;
  }

  const provider = await getMessagingProvider(hotelId, campaign.channel);

  if (provider.name === 'none') {
    await Campaign.findByIdAndUpdate(campaignObjId, {
      status:        'failed',
      failureReason: 'No messaging provider configured. Add MSG91 credentials in Settings → Integrations.',
    });
    logger.info(`[campaignWorker] dispatchCampaignById ${campaignId}: no provider — marked failed`);
    return;
  }

  await _doCampaignDispatch(campaign, provider, hotelObjId);
}

// ── Public: scheduled dispatch entry point (called by scheduler.ts every 60s) ─

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
        // Atomic claim: lock to 'failed' for crash safety.
        // If the process dies after this and before the final update, the campaign
        // stays 'failed' (recoverable) rather than stuck in a false 'sent' state.
        const locked = await Campaign.findOneAndUpdate(
          { _id: campaign._id, status: 'scheduled' },
          { $set: { status: 'failed', failureReason: 'Dispatch in progress' } },
          { new: false },
        );
        if (!locked) continue; // Another worker instance already claimed it

        // Hotel-scoped provider resolution
        const provider = await getMessagingProvider(String(campaign.hotelId), campaign.channel);

        if (provider.name === 'none') {
          // Revert to 'scheduled' so it is retried once a provider is configured
          await Campaign.findByIdAndUpdate(campaign._id, {
            status:        'scheduled',
            failureReason: '',
          });
          logger.info(`[campaignWorker] campaign ${String(campaign._id)}: no provider — reverted to scheduled`);
          continue;
        }

        await _doCampaignDispatch(campaign, provider, campaign.hotelId as mongoose.Types.ObjectId);
      } catch (err) {
        logger.error(`[campaignWorker] error dispatching campaign ${String(campaign._id)}`, {
          err: String(err),
        });
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
