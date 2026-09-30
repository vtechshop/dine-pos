/**
 * Trial Reminder Worker
 *
 * runTrialReminderWorker() — called by scheduler every 4 hours.
 *
 * Sends WhatsApp notifications to trial hotels approaching expiry:
 *  - Day 7 reminder: sent when ≤ 7 days remain in trial
 *  - Day 12 reminder: sent when ≤ 2 days remain in trial
 *
 * Idempotency: trialReminder7SentAt / trialReminder12SentAt are set via
 * atomic findOneAndUpdate before the send attempt. If the send fails the
 * timestamp remains set — no retries. This prevents infinite-loop spamming
 * on permanent failures (invalid phone, unregistered WA number, etc.).
 *
 * Multi-branch safety: only standalone hotels (parentHotelId: null) receive
 * reminders. Branches share their HQ's phone and would create duplicate sends.
 *
 * MSG91 templates required (must be Meta-approved before live delivery):
 *  - dinepos_trial_7day_reminder  — 7 days remaining
 *  - dinepos_trial_2day_reminder  — 2 days remaining
 *
 * REAL MSG91 VALIDATION: PENDING — templates above must be created and
 * approved in the MSG91 dashboard before sends will succeed in production.
 */

import Hotel from '../models/Hotel';
import { getMessagingProvider } from '../services/messagingProvider';
import { normalizePhone }        from '../utils/phoneUtils';
import { logger }                from '../utils/logger';

const REMINDER_7_TEMPLATE  = 'dinepos_trial_7day_reminder';
const REMINDER_12_TEMPLATE = 'dinepos_trial_2day_reminder';
const TEMPLATE_LANGUAGE    = 'en';

const DAY7_THRESHOLD_DAYS  = 7;
const DAY12_THRESHOLD_DAYS = 2;

export async function runTrialReminderWorker(): Promise<void> {
  const now = new Date();
  await _sendDay7Reminders(now);
  await _sendDay12Reminders(now);
}

async function _sendDay7Reminders(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() + DAY7_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  const hotels = await Hotel.find({
    status:               'trial',
    trialReminder7SentAt: null,
    parentHotelId:        null,   // standalone or HQ only — not branches
    trialEndDate:         { $gt: now, $lte: cutoff },
  }).select('_id phone hotelName').lean();

  for (const hotel of hotels) {
    const claimed = await Hotel.findOneAndUpdate(
      { _id: hotel._id, trialReminder7SentAt: null },
      { $set: { trialReminder7SentAt: now } },
      { new: false },
    );
    if (!claimed) continue; // another instance already claimed

    await _dispatchReminder(
      String(hotel._id),
      (hotel as any).phone,
      (hotel as any).hotelName,
      REMINDER_7_TEMPLATE,
      DAY7_THRESHOLD_DAYS,
    );
  }
}

async function _sendDay12Reminders(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() + DAY12_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  const hotels = await Hotel.find({
    status:                'trial',
    trialReminder12SentAt: null,
    parentHotelId:         null,
    trialEndDate:          { $gt: now, $lte: cutoff },
  }).select('_id phone hotelName').lean();

  for (const hotel of hotels) {
    const claimed = await Hotel.findOneAndUpdate(
      { _id: hotel._id, trialReminder12SentAt: null },
      { $set: { trialReminder12SentAt: now } },
      { new: false },
    );
    if (!claimed) continue;

    await _dispatchReminder(
      String(hotel._id),
      (hotel as any).phone,
      (hotel as any).hotelName,
      REMINDER_12_TEMPLATE,
      DAY12_THRESHOLD_DAYS,
    );
  }
}

async function _dispatchReminder(
  hotelId:      string,
  rawPhone:     string,
  hotelName:    string,
  templateName: string,
  daysLeft:     number,
): Promise<void> {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    logger.warn('[trialReminder] Invalid phone — skipping send', { hotelId });
    return;
  }

  try {
    const provider = await getMessagingProvider(hotelId, 'whatsapp');

    if (provider.name === 'none') {
      logger.info('[trialReminder] No provider configured — skipping send', { hotelId });
      return;
    }

    const result = await provider.sendMessages(
      `trial-reminder-${hotelId}-${templateName}`,
      'whatsapp',
      [{
        phone,
        message: '',
        vars:    { hotelName, daysLeft: String(daysLeft) },
      }],
      {
        templateName,
        templateLanguage:  TEMPLATE_LANGUAGE,
        templateNamespace: '',
        templateVars:      [hotelName, String(daysLeft)],
      },
    );

    if (result.status === 'sent' || result.status === 'partial') {
      logger.info('[trialReminder] Reminder sent', { hotelId, templateName, daysLeft });
    } else {
      logger.warn('[trialReminder] Send not accepted', {
        hotelId,
        templateName,
        status: result.status,
        reason: result.reason,
      });
    }
  } catch (err) {
    // Claim timestamp is NOT reset — prevents retry loops on permanent failures
    logger.error('[trialReminder] Error sending reminder', {
      hotelId,
      templateName,
      err: String(err),
    });
  }
}
