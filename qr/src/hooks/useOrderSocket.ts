import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:5000';

interface UseOrderSocketOptions {
  hotelId:     string;
  tableNumber: string;
  enabled:     boolean;
  onUpdate?:   () => void;
}

// Joins table_<hotelId>_<tableNumber> only.
// Backend H-04 fix blocks admin_* and hotel_* rooms for unauthenticated sockets.
// Since the backend does NOT emit events to customer/table rooms, this hook
// triggers an optional callback for UI refresh but polling is the primary data source.
export function useOrderSocket({
  hotelId,
  tableNumber,
  enabled,
  onUpdate,
}: UseOrderSocketOptions): void {
  const socketRef = useRef<Socket | null>(null);
  const roomRef   = useRef(`table_${hotelId}_${tableNumber}`);

  useEffect(() => {
    if (!enabled || !hotelId || !tableNumber) return;

    const socket = io(SOCKET_URL, {
      transports:         ['websocket'],
      reconnectionDelay:  2000,
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', roomRef.current);
    });

    // Best-effort — backend may emit future customer events here
    socket.on('order_update', () => onUpdate?.());
    socket.on('session_update', () => onUpdate?.());

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [hotelId, tableNumber, enabled, onUpdate]);
}
