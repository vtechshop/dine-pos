import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
  reconnecting: boolean;
  /** Increments each time the socket successfully reconnects after a drop. */
  reconnectCount: number;
}

const SocketContext = createContext<SocketContextType>({
  socket:         null,
  connected:      false,
  reconnecting:   false,
  reconnectCount: 0,
});

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:5000';

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, hotelId, isAuthenticated } = useAuth();
  const [socket,         setSocket]         = useState<Socket | null>(null);
  const [connected,      setConnected]      = useState(false);
  const [reconnecting,   setReconnecting]   = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !token || !hotelId) {
      setSocket(prev => { prev?.disconnect(); return null; });
      setConnected(false);
      setReconnecting(false);
      return;
    }

    const s = io(SOCKET_URL, {
      transports:           ['websocket'],
      auth:                 { token },
      reconnectionAttempts: 20,
      reconnectionDelay:    3_000,
    });

    let everConnected = false;

    s.on('connect', () => {
      s.emit('join_hotel', hotelId);
      if (everConnected) {
        // This is a successful reconnect — notify listeners so they can refresh stale data
        setReconnectCount(n => n + 1);
      }
      everConnected = true;
      setConnected(true);
      setReconnecting(false);
    });

    s.on('disconnect', () => {
      setConnected(false);
    });

    s.on('connect_error', (err: Error) => {
      setConnected(false);
      // H-05 / H-03: the server rejected our token as expired or invalid.
      // Stop Socket.IO's built-in retry loop — the next HTTP API call's 401
      // interceptor will silently refresh the token, update AuthContext state
      // (which changes `token` in the effect deps), and this effect will
      // then create a fresh socket connection with the new token.
      if (err.message?.toLowerCase().includes('authentication')) {
        s.disconnect();
      }
    });

    // Manager-level events for reconnect attempts
    s.io.on('reconnect_attempt', () => setReconnecting(true));
    s.io.on('reconnect_failed', () => setReconnecting(false));

    setSocket(s);

    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
      setReconnecting(false);
    };
  }, [isAuthenticated, token, hotelId]);

  return (
    <SocketContext.Provider value={{ socket, connected, reconnecting, reconnectCount }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketContextType {
  return useContext(SocketContext);
}
