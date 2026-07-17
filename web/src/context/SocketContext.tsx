import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextType>({ socket: null, connected: false });

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:5000';

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, hotelId, isAuthenticated } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !token || !hotelId) {
      setSocket(prev => { prev?.disconnect(); return null; });
      setConnected(false);
      return;
    }

    const s = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: { token },
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
    });

    s.on('connect', () => {
      s.emit('join_hotel', hotelId);
      setConnected(true);
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', () => setConnected(false));

    setSocket(s);

    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [isAuthenticated, token, hotelId]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketContextType {
  return useContext(SocketContext);
}
