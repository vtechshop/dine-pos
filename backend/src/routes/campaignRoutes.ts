/**
 * Campaign Routes
 * Mount point: /api/campaigns
 *
 * NOTE: WhatsApp/SMS delivery is NOT implemented here.
 * The route layer creates/manages campaign records. When a provider
 * (e.g. WhatsApp Business API, MSG91) is integrated, it should be wired
 * into POST /:id/send. Until then, send returns { status: 'no_provider' }.
 *
 * All routes require: authMiddleware + requireAdmin (campaign management is admin-only)
 */

import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';
import Campaign, { CampaignAudience } from '../models/Campaign';
import CustomerProfile from '../models/CustomerProfile';

const router = Router();

router.use(authMiddleware);
router.use(requireAdmin);

const VALID_AUDIENCES: CampaignAudience[] = [
  'all', 'new', 'repeat', 'vip',
  'inactive30', 'inactive60', 'inactive90',
  'birthday', 'anniversary', 'loyalty', 'noloyalty', 'custom',
];

// ── GET /api/campaigns — list all campaigns ──────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, page = '1', limit = '20' } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip     = (pageNum - 1) * limitNum;

    const filter: Record<string, any> = { hotelId: new mongoose.Types.ObjectId(req.hotelId) };
    if (status && ['draft', 'scheduled', 'sent', 'failed', 'cancelled'].includes(status)) {
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
    const { name, channel, audience, customAudience, messageTemplate, scheduledAt } = req.body as Record<string, any>;

    if (!name || !String(name).trim()) {
      res.status(400).json({ message: 'name is required' });
      return;
    }
    if (!['whatsapp', 'sms'].includes(channel)) {
      res.status(400).json({ message: 'channel must be "whatsapp" or "sms"' });
      return;
    }
    if (!VALID_AUDIENCES.includes(audience as CampaignAudience)) {
      res.status(400).json({ message: `audience must be one of: ${VALID_AUDIENCES.join(', ')}` });
      return;
    }
    if (!messageTemplate || !String(messageTemplate).trim()) {
      res.status(400).json({ message: 'messageTemplate is required' });
      return;
    }

    // Only {name} and {hotel} are substituted at send time
    const badVars = validateTemplateVars(String(messageTemplate));
    if (badVars.length > 0) {
      res.status(400).json({
        message: `Unknown template variable(s): ${badVars.map(v => `{${v}}`).join(', ')}. Allowed: {name}, {hotel}`,
      });
      return;
    }

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);

    // Validate scheduledAt if provided
    let parsedScheduledAt: Date | null = null;
    if (scheduledAt) {
      parsedScheduledAt = new Date(scheduledAt);
      if (isNaN(parsedScheduledAt.getTime())) {
        res.status(400).json({ message: 'scheduledAt must be a valid ISO date string' });
        return;
      }
      if (parsedScheduledAt <= new Date()) {
        res.status(400).json({ message: 'scheduledAt must be a future date/time' });
        return;
      }
    }

    // Compute audience size (total) and eligible count (opted-in with phone)
    const { count, eligibleCount } = await resolveAudienceCount(hotelObjId, audience, customAudience);

    const campaign = await Campaign.create({
      hotelId:         hotelObjId,
      name:            String(name).trim().slice(0, 200),
      channel,
      audience,
      customAudience:  audience === 'custom' && Array.isArray(customAudience)
        ? customAudience.map((id: string) => new mongoose.Types.ObjectId(id))
        : [],
      messageTemplate: String(messageTemplate).trim().slice(0, 4000),
      status:          parsedScheduledAt ? 'scheduled' : 'draft',
      scheduledAt:     parsedScheduledAt,
      recipientCount:  count,
      eligibleCount,
      createdBy:       `admin:${req.hotelId}`,
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
      _id: new mongoose.Types.ObjectId(req.params.id),
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
    }).lean();

    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return; }
    res.json({ campaign });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch campaign', err);
  }
});

// ── PATCH /api/campaigns/:id — update draft campaign ─────────────────────────
router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaign = await Campaign.findOne({
      _id: new mongoose.Types.ObjectId(req.params.id),
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
    });
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return; }
    if (campaign.status === 'sent') {
      res.status(409).json({ message: 'Cannot edit a sent campaign' });
      return;
    }

    const { name, messageTemplate, scheduledAt, audience, customAudience } = req.body as Record<string, any>;
    if (name)            campaign.name            = String(name).trim().slice(0, 200);
    if (messageTemplate) {
      const badVars = validateTemplateVars(String(messageTemplate));
      if (badVars.length > 0) {
        res.status(400).json({
          message: `Unknown template variable(s): ${badVars.map(v => `{${v}}`).join(', ')}. Allowed: {name}, {hotel}`,
        });
        return;
      }
      campaign.messageTemplate = String(messageTemplate).trim().slice(0, 4000);
    }
    if (scheduledAt !== undefined) campaign.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;

    if (audience && VALID_AUDIENCES.includes(audience as CampaignAudience)) {
      campaign.audience = audience;
      if (audience === 'custom' && Array.isArray(customAudience)) {
        campaign.customAudience = customAudience.map((id: string) => new mongoose.Types.ObjectId(id));
      } else {
        campaign.customAudience = [];
      }
      const { count, eligibleCount } = await resolveAudienceCount(
        new mongoose.Types.ObjectId(req.hotelId), audience, customAudience,
      );
      campaign.recipientCount = count;
      campaign.eligibleCount  = eligibleCount;
    }

    // Update scheduledAt if provided
    if (req.body.scheduledAt !== undefined) {
      if (req.body.scheduledAt === null) {
        campaign.scheduledAt = null;
        if (campaign.status === 'scheduled') campaign.status = 'draft';
      } else {
        const parsed = new Date(req.body.scheduledAt as string);
        if (!isNaN(parsed.getTime())) {
          campaign.scheduledAt = parsed;
          campaign.status      = 'scheduled';
        }
      }
    }

    await campaign.save();
    res.json({ campaign });
  } catch (err) {
    sendError(res, 500, 'Failed to update campaign', err);
  }
});

// ── POST /api/campaigns/:id/send — manual send trigger (provider stub) ────────
// No provider is configured: returns no_provider without changing campaign status.
// When a real provider is integrated, this endpoint should:
//   1. Atomically lock the campaign (findOneAndUpdate with status condition)
//   2. Re-resolve recipients at send time
//   3. Call the provider
//   4. Update campaign to 'sent' or 'failed'
router.post('/:id/send', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);
    const campaign = await Campaign.findOne({
      _id:     new mongoose.Types.ObjectId(req.params.id),
      hotelId: hotelObjId,
    });
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return; }
    if (['sent', 'cancelled'].includes(campaign.status)) {
      res.status(409).json({ message: `Campaign is already ${campaign.status}` });
      return;
    }

    // Re-resolve eligible count fresh at send time — stale count from creation may differ
    let freshEligibleCount = campaign.eligibleCount;
    try {
      const { eligibleCount } = await resolveAudienceCount(
        hotelObjId,
        campaign.audience,
        (campaign.customAudience as mongoose.Types.ObjectId[]).map(id => id.toString()),
      );
      freshEligibleCount = eligibleCount;
    } catch {
      // Non-fatal — fall back to stored count if re-resolve fails
    }

    // Campaign status is NOT changed — it stays draft/scheduled until a real provider sends.
    res.json({
      status:  'no_provider',
      message: 'No WhatsApp/SMS provider configured. Connect a provider in Settings → Integrations to enable delivery.',
      campaign: {
        _id:            campaign._id,
        name:           campaign.name,
        channel:        campaign.channel,
        recipientCount: campaign.recipientCount,
        eligibleCount:  freshEligibleCount,
      },
    });
  } catch (err) {
    sendError(res, 500, 'Failed to send campaign', err);
  }
});

// ── DELETE /api/campaigns/:id — cancel/delete draft ──────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaign = await Campaign.findOne({
      _id: new mongoose.Types.ObjectId(req.params.id),
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
    });
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return; }
    if (campaign.status === 'sent') {
      res.status(409).json({ message: 'Cannot delete a sent campaign' });
      return;
    }
    campaign.status = 'cancelled';
    await campaign.save();
    res.json({ message: 'Campaign cancelled' });
  } catch (err) {
    sendError(res, 500, 'Failed to cancel campaign', err);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildAudienceFilter(
  hotelObjId: mongoose.Types.ObjectId,
  audience: string,
): Record<string, any> {
  const filter: Record<string, any> = { hotelId: hotelObjId, status: { $ne: 'merged' } };
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
    case 'birthday':     filter.birthday     = { $regex: `^${mm}-`, $ne: null }; break;
    case 'anniversary':  filter.anniversary  = { $regex: `^${mm}-`, $ne: null }; break;
    case 'loyalty':      filter.loyaltyBalance = { $gt: 0 }; break;
    case 'noloyalty':
      filter.loyaltyBalance = 0;
      filter.visitCount     = { $gt: 0 };
      break;
    // 'all' — no extra filter beyond base
  }

  return filter;
}

/**
 * Returns total audience size AND opted-in eligible count.
 * eligible = marketingOptIn:true AND has a phone number.
 */
async function resolveAudienceCount(
  hotelObjId: mongoose.Types.ObjectId,
  audience: string,
  customAudience?: string[],
): Promise<{ count: number; eligibleCount: number }> {
  if (audience === 'custom') {
    const ids = Array.isArray(customAudience)
      ? customAudience.map(id => new mongoose.Types.ObjectId(id))
      : [];
    const [count, eligibleCount] = await Promise.all([
      CustomerProfile.countDocuments({ _id: { $in: ids }, hotelId: hotelObjId }),
      CustomerProfile.countDocuments({ _id: { $in: ids }, hotelId: hotelObjId, marketingOptIn: true, phone: { $ne: null } }),
    ]);
    return { count, eligibleCount };
  }

  const base = buildAudienceFilter(hotelObjId, audience);
  const [count, eligibleCount] = await Promise.all([
    CustomerProfile.countDocuments(base),
    CustomerProfile.countDocuments({ ...base, marketingOptIn: true, phone: { $ne: null } }),
  ]);
  return { count, eligibleCount };
}

/**
 * Returns unknown variable names found in a message template.
 * Allowed: {name}, {hotel}. Any other {word} is rejected server-side.
 */
function validateTemplateVars(template: string): string[] {
  const ALLOWED = new Set(['name', 'hotel']);
  const found = [...template.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
  return [...new Set(found.filter(v => !ALLOWED.has(v)))];
}

export default router;
