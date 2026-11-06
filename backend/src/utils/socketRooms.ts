import mongoose from 'mongoose';

// Room-membership rules for the `join_hotel` socket event.
//
//   hotel_<id>  — staff events incl. customer PII (new_order phone/address, totals)
//   admin_<id>  — admin-only events
//   public_<id> — customer kiosk/QR screens: order status only (no PII)
//
// Authenticated sockets may only join their own JWT hotel. Anonymous sockets
// may only ever join the public room.
export interface JoinHotelDecision {
  rooms:  string[];
  /** Set for anonymous sockets so table-chat rooms can be scoped to the hotel. */
  anonHotelId?: string;
  rejected?: 'invalid' | 'mismatch' | 'invalid_format';
}

export function resolveJoinHotelRooms(
  socketData: { authenticated?: boolean; hotelId?: string },
  requestedHotelId: unknown,
): JoinHotelDecision {
  if (typeof requestedHotelId !== 'string' || !requestedHotelId) {
    return { rooms: [], rejected: 'invalid' };
  }
  if (socketData.authenticated) {
    if (socketData.hotelId !== requestedHotelId) return { rooms: [], rejected: 'mismatch' };
    return { rooms: [`hotel_${requestedHotelId}`, `admin_${requestedHotelId}`] };
  }
  if (!mongoose.isValidObjectId(requestedHotelId)) {
    return { rooms: [], rejected: 'invalid_format' };
  }
  return { rooms: [`public_${requestedHotelId}`], anonHotelId: requestedHotelId };
}
