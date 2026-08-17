/**
 * Campaign Routes
 * Mount point: /api/campaigns
 *
 * All routes require authMiddleware + requireAdmin (campaign management is admin-only).
 *
 * Security invariants:
 *  - hotelId always sourced from JWT (req.hotelId), never from request body
 *  - Provider credentials never exposed through this module — all provider ops
 *    happen inside campaignWorker / messagingProvider services
 *  - marketingOptIn enforced at dispatch time in resolveRecipients (worker)
 *  - Blocked/inactive customers excluded by the 'active' status filter
 *  - Dispatch is idempotent: atomic 'sending' claim prevents double-dispatch
 */

import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';
import Campaign, { CampaignAudience } from '../models/Campaign';
import CustomerProfile from '../models/CustomerProfile';
import MessagingProviderConfig from '../models/MessagingProviderConfig';
import { dispatchCampaignById } from '../workers/campaignWorker';
import { logger } from '../utils/logger';
import CampaignMessage from '../models/CampaignMessage';
import Hotel           from '../models/Hotel';
import { getMessagingProvider } from '../services/messagingProvider';
import type { WaTemplateOptions } from '../services/messagingProvider';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

const VALID_AUDIENCES: CampaignAudience[] = [
  'all', 'new', 'repeat', 'vip',
  'inactive30', 'inactive60', 'inactive90',
  'birthday', 'anniversary', 'birthdayweek', 'anniversaryweek',
  'loyalty', 'noloyalty', 'custom',
];

const VALID_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'partial', 'failed', 'cancelled'];

// ── GET /api/campaigns/provider-status ───────────────────────────────────────
// IMPORTANT: registered before /:id so 'provider-status' is not matched as ObjectId.
router.get('/provider-status', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cfg = await MessagingProviderConfig.findOne({
      hotelId:   new mongoose.Types.ObjectId(req.hotelId!),
      isActive:  true,
      isDeleted: false,
    }).lean();

    if (!cfg) {
      res.json({ configured: { whatsapp: false, sms: false }, providerType: null });
      return;
    }

    res.json({
      configured: {
        whatsapp: cfg.channel === 'whatsapp' || cfg.channel === 'both',
        sms:      cfg.channel === 'sms'      || cfg.channel === 'both',
      },
      providerType: cfg.providerType,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch provider status', err);
  }
});

// ── GET /api/campaigns/audience-count ────────────────────────────────────────
// IMPORTANT: registered before /:id so 'audience-count' is not matched as ObjectId.
router.get('/audience-count', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { audience } = req.query as Record<string, string>;
    if (!audience || !VALID_AUDIENCES.includes(audience as CampaignAudience)) {
      res.status(400).json({ message: 'audience must be a valid segment value' });
      return;
    }
    if (audience === 'custom') {
      res.json({ count: 0, eligibleCount: 0 });
      return;
    }
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId!);
    const result = await resolveAudienceCount(hotelObjId, audience);
    res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch audience count', err);
  }
});

// ── GET /api/campaigns — list all campaigns ──────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, page = '1', limit = '20' } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip     = (pageNum - 1) * limitNum;

    const filter: Record<string, any> = { hotelId: new mongoose.Types.ObjectId(req.hotelId!) };
    if (status && VALID_STATUSES.includes(status)) {
      filter.status = status;
    }

    const [campaigns, total] = await Promise.all([
      Campaign.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Campaign.countDocuments(filter),
    ]);

    res.json({ campaigns, total, page: pageNum, limit: limitNum });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch campaigns', err);
  }
});

// ── POST /api/campaigns — create campaign ────────────────────────────────────
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      name, channel, audience, customAudience, messageTemplate, scheduledAt,
      waTemplateName, waTemplateLanguage, waTemplateNamespace, waTemplateVars,
    } = req.body as Record<string, any>;

    if (!name || !String(name).trim()) {
      res.status(400).json({ message: 'name is required' }); return;
    }
    if (!['whatsapp', 'sms'].includes(channel)) {
      res.status(400).json({ message: 'channel must be "whatsapp" or "sms"' }); return;
    }
    if (!VALID_AUDIENCES.includes(audience as CampaignAudience)) {
      res.status(400).json({ message: `audience must be one of: ${VALID_AUDIENCES.join(', ')}` }); return;
    }
    if (!messageTemplate || !String(messageTemplate).trim()) {
      res.status(400).json({ message: 'messageTemplate is required' }); return;
    }

    const badVars = validateTemplateVars(String(messageTemplate));
    if (badVars.length > 0) {
      res.status(400).json({
        message: `Unknown template variable(s): ${badVars.map(v => `{${v}}`).join(', ')}. Allowed: {name}, {hotel}, {points}`,
      }); return;
    }

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId!);

    let parsedScheduledAt: Date | null = null;
    if (scheduledAt) {
      parsedScheduledAt = new Date(scheduledAt);
      if (isNaN(parsedScheduledAt.getTime())) {
        res.status(400).json({ message: 'scheduledAt must be a valid ISO date string' }); return;
      }
      if (parsedScheduledAt <= new Date()) {
        res.status(400).json({ message: 'scheduledAt must be a future date/time' }); return;
      }
    }

    const { count, eligibleCount } = await resolveAudienceCount(hotelObjId, audience, customAudience);

    const campaign = await Campaign.create({
      hotelId:             hotelObjId,
      name:                String(name).trim().slice(0, 200),
      channel,
      audience,
      customAudience:      audience === 'custom' && Array.isArray(customAudience)
        ? customAudience.map((id: string) => new mongoose.Types.ObjectId(id))
        : [],
      messageTemplate:     String(messageTemplate).trim().slice(0, 4000),
      status:              parsedScheduledAt ? 'scheduled' : 'draft',
      scheduledAt:         parsedScheduledAt,
      recipientCount:      count,
      eligibleCount,
      createdBy:           `admin:${req.hotelId}`,
      waTemplateName:      waTemplateName ? String(waTemplateName).trim().slice(0, 200) : null,
      waTemplateLanguage:  waTemplateLanguage ? String(waTemplateLanguage).trim().slice(0, 20) : 'en',
      waTemplateNamespace: waTemplateNamespace ? String(waTemplateNamespace).trim().slice(0, 200) : '',
      waTemplateVars:      Array.isArray(waTemplateVars)
        ? (waTemplateVars as any[]).map((v: any) => String(v).trim().slice(0, 50)).slice(0, 10)
        : [],
    });

    res.status(201).json({ campaign });
  } catch (err) {
    sendError(res, 500, 'Failed to create campaign', err);
  }
});

// ── GET /api/campaigns/:id — campaign detail ─────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaign = await Campaign.findOne({
      _id:     new mongoose.Types.ObjectId(req.params.id),
      hotelId: new mongoose.Types.ObjectId(req.hotelId!),
    }).lean();

    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return; }
    res.json({ campaign });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch campaign', err);
  }
});

// ── PATCH /api/campaigns/:id — update draft/scheduled campaign ────────────────
router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaign = await Campaign.findOne({
      _id:     new mongoose.Types.ObjectId(req.params.id),
      hotelId: new mongoose.Types.ObjectId(req.hotelId!),
    });
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return; }

    if (['sent', 'sending', 'cancelled'].includes(campaign.status)) {
      res.status(409).json({ message: `Cannot edit a campaign with status '${campaign.status}'` });
      return;
    }

    const {
      name, messageTemplate, audience, customAudience,
      waTemplateName, waTemplateLanguage, waTemplateNamespace, waTemplateVars,
    } = req.body as Record<string, any>;

    if (name) campaign.name = String(name).trim().slice(0, 200);

    if (messageTemplate) {
      const badVars = validateTemplateVars(String(messageTemplate));
      if (badVars.length > 0) {
        res.status(400).json({
          message: `Unknown template variable(s): ${badVars.map(v => `{${v}}`).join(', ')}. Allowed: {name}, {hotel}, {points}`,
        }); return;
      }
      campaign.messageTemplate = String(messageTemplate).trim().slice(0, 4000);
    }

    if (audience && VALID_AUDIENCES.includes(audience as CampaignAudience)) {
      campaign.audience = audience;
      if (audience === 'custom' && Array.isArray(customAudience)) {
        campaign.customAudience = customAudience.map((id: string) => new mongoose.Types.ObjectId(id));
      } else {
        campaign.customAudience = [];
      }
      const { count, eligibleCount } = await resolveAudienceCount(
        new mongoose.Types.ObjectId(req.hotelId!), audience, customAudience,
      );
      campaign.recipientCount = count;
      campaign.eligibleCount  = eligibleCount;
    }

    // WA template fields
    if (waTemplateName !== undefined) {
      campaign.waTemplateName = waTemplateName ? String(waTemplateName).trim().slice(0, 200) : null;
    }
    if (waTemplateLanguage !== undefined) {
      campaign.waTemplateLanguage = String(waTemplateLanguage).trim().slice(0, 20) || 'en';
    }
    if (waTemplateNamespace !== undefined) {
      campaign.waTemplateNamespace = String(waTemplateNamespace).trim().slice(0, 200);
    }
    if (waTemplateVars !== undefined && Array.isArray(waTemplateVars)) {
      campaign.waTemplateVars = (waTemplateVars as any[]).map((v: any) => String(v).trim().slice(0, 50)).slice(0, 10);
    }

    if (req.body.scheduledAt !== undefined) {
      if (req.body.scheduledAt === null) {
        campaign.scheduledAt = null;
        if (campaign.status === 'scheduled') campaign.status = 'draft';
      } else {
        const parsed = new Date(req.body.scheduledAt as string);
        if (isNaN(parsed.getTime())) {
          res.status(400).json({ message: 'scheduledAt must be a valid ISO date string' }); return;
        }
        if (parsed <= new Date()) {
          res.status(400).json({ message: 'scheduledAt must be a future date/time' }); return;
        }
        campaign.scheduledAt = parsed;
        campaign.status      = 'scheduled';
      }
    }

    await campaign.save();
    res.json({ campaign });
  } catch (err) {
    sendError(res, 500, 'Failed to update campaign', err);
  }
});

// ── POST /api/campaigns/:id/send — manual dispatch ───────────────────────────
//
// 1. Validates campaign state and WhatsApp requirements
// 2. Verifies a provider is configured for this hotel
// 3. Atomically locks the campaign to 'sending' (prevents scheduler race)
// 4. Responds 202 immediately
// 5. Dispatches asynchronously via dispatchCampaignById (fire-and-forget)
router.post('/:id/send', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelObjId   = new mongoose.Types.ObjectId(req.hotelId!);
    const campaignObjId = new mongoose.Types.ObjectId(req.params.id);

    const campaign = await Campaign.findOne({ _id: campaignObjId, hotelId: hotelObjId });
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return; }

    if (['sent', 'sending', 'cancelled'].includes(campaign.status)) {
      res.status(409).json({ message: `Campaign is already ${campaign.status}` });
      return;
    }

    // WhatsApp campaigns must have a pre-approved template name
    if (campaign.channel === 'whatsapp' && !campaign.waTemplateName) {
      res.json({
        status:  'no_wa_template',
        message: 'WhatsApp campaigns require a pre-approved MSG91 template name. Edit the campaign to add one.',
      });
      return;
    }

    // Verify a provider is configured for this hotel + channel before locking
    const cfg = await MessagingProviderConfig.findOne({
      hotelId:   hotelObjId,
      isActive:  true,
      isDeleted: false,
      $or: [{ channel: campaign.channel }, { channel: 'both' }],
    }).lean();

    if (!cfg) {
      res.json({
        status:  'no_provider',
        message: 'No messaging provider configured for this channel. Add MSG91 credentials in Settings → Integrations.',
      });
      return;
    }

    // Atomic claim to 'sending' — prevents scheduler from re-claiming and
    // concurrent send requests from double-dispatching.
    const locked = await Campaign.findOneAndUpdate(
      { _id: campaignObjId, hotelId: hotelObjId, status: { $nin: ['sent', 'sending', 'cancelled'] } },
      { $set: { status: 'sending' } },
      { new: false },
    );
    if (!locked) {
      res.status(409).json({ message: 'Campaign is already being dispatched or cannot be sent' });
      return;
    }

    // Respond 202 immediately — dispatch happens asynchronously
    res.status(202).json({
      status:  'dispatching',
      message: 'Campaign dispatch started. Check campaign status for delivery results.',
    });

    // Fire-and-forget dispatch — errors are caught and persisted to campaign.failureReason
    void (async () => {
      try {
        await dispatchCampaignById(String(campaignObjId), String(hotelObjId));
      } catch (err) {
        logger.error('[campaignRoutes] async dispatch error', {
          campaignId: String(campaignObjId),
          err:        String(err),
        });
        await Campaign.findByIdAndUpdate(campaignObjId, {
          status:        'failed',
          failureReason: String(err).slice(0, 500),
        }).catch(() => {});
      }
    })();
  } catch (err) {
    sendError(res, 500, 'Failed to dispatch campaign', err);
  }
});

// ── DELETE /api/campaigns/:id — cancel/soft-delete ───────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaign = await Campaign.findOne({
      _id:     new mongoose.Types.ObjectId(req.params.id),
      hotelId: new mongoose.Types.ObjectId(req.hotelId!),
    });
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return; }
    if (['sent', 'sending'].includes(campaign.status)) {
      res.status(409).json({ message: `Cannot cancel a campaign with status '${campaign.status}'` });
      return;
    }
    campaign.status = 'cancelled';
    await campaign.save();
    res.json({ message: 'Campaign cancelled' });
  } catch (err) {
    sendError(res, 500, 'Failed to cancel campaign', err);
  }
});

// ── GET /api/campaigns/:id/messages — delivery report ────────────────────────
router.get('/:id/messages', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelObjId    = new mongoose.Types.ObjectId(req.hotelId!);
    const campaignObjId = new mongoose.Types.ObjectId(req.params.id);

    const campaign = await Campaign.findOne({ _id: campaignObjId, hotelId: hotelObjId }).lean();
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return; }

    const { page = '1', limit = '50', status } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip     = (pageNum - 1) * limitNum;

    const msgFilter: Record<string, any> = { campaignId: campaignObjId, hotelId: hotelObjId };
    const VALID_MSG_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed'];
    if (status && VALID_MSG_STATUSES.includes(status)) msgFilter.status = status;

    const [statsResult, messages, total] = await Promise.all([
      CampaignMessage.aggregate([
        { $match: { campaignId: campaignObjId, hotelId: hotelObjId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      CampaignMessage.find(msgFilter)
        .sort({ queuedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('-__v')
        .lean(),
      CampaignMessage.countDocuments(msgFilter),
    ]);

    const stats: Record<string, number> = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    let statsTotal = 0;
    for (const row of statsResult) {
      const s = String(row._id);
      if (s in stats) { stats[s] = row.count as number; statsTotal += row.count as number; }
    }

    res.json({ stats: { ...stats, total: statsTotal }, messages, total, page: pageNum, limit: limitNum });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch campaign messages', err);
  }
});

// ── POST /api/campaigns/:id/duplicate — clone as draft ───────────────────────
router.post('/:id/duplicate', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelObjId    = new mongoose.Types.ObjectId(req.hotelId!);
    const campaignObjId = new mongoose.Types.ObjectId(req.params.id);

    const source = await Campaign.findOne({ _id: campaignObjId, hotelId: hotelObjId }).lean();
    if (!source) { res.status(404).json({ message: 'Campaign not found' }); return; }

    const campaign = await Campaign.create({
      hotelId:             hotelObjId,
      name:                `${source.name} (Copy)`.slice(0, 200),
      channel:             source.channel,
      audience:            source.audience,
      customAudience:      source.customAudience ?? [],
      messageTemplate:     source.messageTemplate,
      status:              'draft',
      scheduledAt:         null,
      recipientCount:      source.recipientCount ?? 0,
      eligibleCount:       source.eligibleCount  ?? 0,
      createdBy:           `admin:${req.hotelId}`,
      waTemplateName:      source.waTemplateName      ?? null,
      waTemplateLanguage:  source.waTemplateLanguage  ?? 'en',
      waTemplateNamespace: source.waTemplateNamespace ?? '',
      waTemplateVars:      source.waTemplateVars      ?? [],
    });

    res.status(201).json({ campaign });
  } catch (err) {
    sendError(res, 500, 'Failed to duplicate campaign', err);
  }
});

// ── POST /api/campaigns/:id/test-send — send to a single test number ─────────
//
// Rate-limited to 5 sends per campaign per 10 minutes.
// Does NOT create a CampaignMessage record.
// Does NOT alter campaign status.
// Does NOT enforce marketingOptIn (it is a test).

const _testSendLimiter = new Map<string, { count: number; resetAt: number }>();
const TEST_SEND_MAX = 5;
const TEST_SEND_WINDOW_MS = 10 * 60 * 1000;

function _checkTestSendLimit(campaignId: string): boolean {
  const now   = Date.now();
  const state = _testSendLimiter.get(campaignId);
  if (!state || now > state.resetAt) {
    _testSendLimiter.set(campaignId, { count: 1, resetAt: now + TEST_SEND_WINDOW_MS });
    return true;
  }
  if (state.count >= TEST_SEND_MAX) return false;
  state.count++;
  return true;
}

// Periodic cleanup — purge expired rate-limiter entries every 60 s.
let _testSendCleanupStarted = false;
if (!_testSendCleanupStarted) {
  _testSendCleanupStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _testSendLimiter) {
      if (now > v.resetAt) _testSendLimiter.delete(k);
    }
  }, 60_000).unref();
}

router.post('/:id/test-send', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelObjId    = new mongoose.Types.ObjectId(req.hotelId!);
    const campaignObjId = new mongoose.Types.ObjectId(req.params.id);

    const rawPhone    = String((req.body as Record<string, any>).phone ?? '').trim();
    const phoneDigits = rawPhone.replace(/[^0-9]/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      res.status(400).json({ message: 'phone must be 10–15 digits (E.164 or local)' });
      return;
    }

    if (!_checkTestSendLimit(String(campaignObjId))) {
      res.status(429).json({ message: 'Too many test sends. Wait 10 minutes before trying again.' });
      return;
    }

    const campaign = await Campaign.findOne({ _id: campaignObjId, hotelId: hotelObjId }).lean();
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return; }

    if (campaign.channel === 'whatsapp' && !campaign.waTemplateName) {
      res.json({ status: 'no_wa_template', message: 'WhatsApp campaigns require a pre-approved MSG91 template name.' });
      return;
    }

    const provider = await getMessagingProvider(String(hotelObjId), campaign.channel);
    if (provider.name === 'none') {
      res.json({ status: 'no_provider', message: 'No messaging provider configured for this channel.' });
      return;
    }

    const hotelDoc  = await Hotel.findById(hotelObjId).select('hotelName').lean();
    const hotelName = (hotelDoc as any)?.hotelName ?? 'our restaurant';
    const testVars  = { name: 'Test Customer', hotel: hotelName, points: '100' };
    const rendered  = campaign.messageTemplate.replace(
      /\{(\w+)\}/g,
      (_, key) => testVars[key as keyof typeof testVars] ?? `{${key}}`,
    );

    const waTemplate: WaTemplateOptions | undefined = campaign.channel === 'whatsapp' && campaign.waTemplateName
      ? {
          templateName:      campaign.waTemplateName as string,
          templateLanguage:  (campaign.waTemplateLanguage  as string) || 'en',
          templateNamespace: (campaign.waTemplateNamespace as string) || '',
          templateVars:      (campaign.waTemplateVars       as string[]) || [],
        }
      : undefined;

    const batchId = `${String(campaignObjId)}_test_${Date.now()}`;
    const result  = await provider.sendMessages(
      batchId,
      campaign.channel,
      [{ phone: phoneDigits, message: rendered, customerId: '', vars: testVars }],
      waTemplate,
    );

    const sent = result.sentCount > 0;
    res.json({
      status:  sent ? 'sent' : 'failed',
      message: sent
        ? `Test message dispatched to ${rawPhone}.`
        : `Send failed: ${result.reason ?? 'Provider error'}`,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to send test message', err);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function nextSevenDayPatterns(): string[] {
  const patterns: string[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d   = new Date(now);
    d.setDate(d.getDate() + i);
    const m   = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    patterns.push(`${m}-${day}`);
  }
  return patterns;
}

function buildAudienceFilter(
  hotelObjId: mongoose.Types.ObjectId,
  audience:   string,
): Record<string, any> {
  const filter: Record<string, any> = { hotelId: hotelObjId, status: { $ne: 'merged' } };
  const now = new Date();
  const mm  = String(now.getMonth() + 1).padStart(2, '0');

  switch (audience) {
    case 'new':     filter.visitCount    = 1;            break;
    case 'repeat':  filter.visitCount    = { $gte: 2 };  break;
    case 'vip':     filter.lifetimeSpend = { $gt: 0 };   break;
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
    // 'all' — no extra filter
  }

  return filter;
}

async function resolveAudienceCount(
  hotelObjId:     mongoose.Types.ObjectId,
  audience:       string,
  customAudience?: string[],
): Promise<{ count: number; eligibleCount: number }> {
  if (audience === 'custom') {
    const ids = Array.isArray(customAudience)
      ? customAudience.map(id => new mongoose.Types.ObjectId(id))
      : [];
    const [count, eligibleCount] = await Promise.all([
      CustomerProfile.countDocuments({ _id: { $in: ids }, hotelId: hotelObjId }),
      CustomerProfile.countDocuments({
        _id: { $in: ids }, hotelId: hotelObjId,
        status: 'active', marketingOptIn: true, phone: { $ne: null },
      }),
    ]);
    return { count, eligibleCount };
  }

  const base = buildAudienceFilter(hotelObjId, audience);
  const [count, eligibleCount] = await Promise.all([
    CustomerProfile.countDocuments(base),
    CustomerProfile.countDocuments({ ...base, status: 'active', marketingOptIn: true, phone: { $ne: null } }),
  ]);
  return { count, eligibleCount };
}

/**
 * Returns unknown variable names from a message template.
 * Allowed: {name}, {hotel}, {points}. Any other {word} is rejected.
 */
function validateTemplateVars(template: string): string[] {
  const ALLOWED = new Set(['name', 'hotel', 'points']);
  const found = [...template.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
  return [...new Set(found.filter(v => !ALLOWED.has(v)))];
}

export default router;
