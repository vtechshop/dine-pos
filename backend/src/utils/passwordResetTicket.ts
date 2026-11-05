import mongoose from 'mongoose';
import Ticket from '../models/Ticket';

export const RESET_TICKET_SUBJECT = 'Password reset request';

/**
 * File (once a day per hotel) a high-priority "Password reset request" ticket so
 * it shows in Super Admin → Support Tickets with the usual alerts. Super Admin
 * resets it from the hotel's page; that also resolves this ticket.
 */
export async function filePasswordResetTicket(
  hotel: { _id: mongoose.Types.ObjectId | string; hotelName: string; phone?: string },
  how: string,
): Promise<void> {
  const hotelId = new mongoose.Types.ObjectId(String(hotel._id));
  const since = new Date(Date.now() - 24 * 3600_000);
  const already = await Ticket.exists({
    hotelId, subject: RESET_TICKET_SUBJECT,
    status: { $in: ['open', 'in-progress'] }, createdAt: { $gte: since },
  });
  if (already) return;
  await Ticket.create({
    hotelId,
    hotelName:   hotel.hotelName,
    hotelPhone:  hotel.phone || '',
    subject:     RESET_TICKET_SUBJECT,
    description: `${how} Reset it from Super Admin → Hotels → this hotel → Reset password, `
               + 'then give the new password to the owner on their registered mobile number.',
    category:    'account',
    priority:    'high',
  });
}
