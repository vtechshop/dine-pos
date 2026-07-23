import { Server } from 'socket.io';
import Lead, { ILead, LeadSource } from '../models/Lead';
import { IInquiry } from '../models/Inquiry';
import { sendLeadAlertToAdmin, sendDemoConfirmationToCustomer } from './emailService';
import { sendLeadPushToSuperAdmins } from './pushService';
import { logger } from '../utils/logger';

export async function createFromInquiry(
  inquiry: IInquiry,
  io: Server | null,
): Promise<ILead> {
  const source: LeadSource = inquiry.type === 'demo' ? 'website_demo' : 'website_contact';

  const lead = await Lead.create({
    ownerName:      inquiry.name,
    companyName:    inquiry.restaurant || inquiry.name,
    phone:          inquiry.phone || '',
    email:          inquiry.email,
    restaurantType: inquiry.notes || '',
    source,
    status:         'new',
    priority:       inquiry.type === 'demo' ? 'high' : 'medium',
    inquiryId:      inquiry._id,
    timeline: [{
      event:     'Lead created',
      note:      `Source: ${source}`,
      actor:     'system',
      createdAt: new Date(),
    }],
  });

  // Socket — notify all SA clients in superadmin room
  try {
    io?.to('superadmin').emit('new_lead', {
      _id:         lead._id,
      ownerName:   lead.ownerName,
      companyName: lead.companyName,
      phone:       lead.phone,
      email:       lead.email,
      source:      lead.source,
      status:      lead.status,
      priority:    lead.priority,
      createdAt:   lead.createdAt,
    });
  } catch (err) {
    logger.error('leadService socket emit error', { err: String(err) });
  }

  // Email to admin + customer — fire and forget
  sendLeadAlertToAdmin(lead).catch(err =>
    logger.error('sendLeadAlertToAdmin error', { err: String(err) }),
  );

  if (inquiry.type === 'demo') {
    sendDemoConfirmationToCustomer(lead).catch(err =>
      logger.error('sendDemoConfirmationToCustomer error', { err: String(err) }),
    );
  }

  // Mobile push to SA devices — fire and forget
  const pushTitle = inquiry.type === 'demo' ? 'New Demo Request' : 'New Contact Lead';
  const pushBody  = `${lead.companyName} — ${lead.phone}`;
  sendLeadPushToSuperAdmins(pushTitle, pushBody).catch(err =>
    logger.error('sendLeadPushToSuperAdmins error', { err: String(err) }),
  );

  return lead;
}
