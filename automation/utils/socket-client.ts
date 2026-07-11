import { io, Socket } from 'socket.io-client';
import { ENV } from './env';

export interface SocketEvent {
  name: string;
  data: unknown;
  receivedAt: number;
}

export class TestSocket {
  private socket: Socket;
  private events: SocketEvent[] = [];
  private connected = false;

  constructor(token?: string) {
    this.socket = io(ENV.SOCKET_URL, {
      transports: ['websocket'],
      auth: { token: token || '' },
      reconnection: false,
      timeout: ENV.SOCKET_TIMEOUT,
    });

    this.socket.on('connect', () => {
      this.connected = true;
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
    });

    // Capture all events
    const originalOnevent = (this.socket as any).onevent.bind(this.socket);
    (this.socket as any).onevent = (packet: any) => {
      const [eventName, ...args] = packet.data || [];
      this.events.push({ name: eventName, data: args[0], receivedAt: Date.now() });
      originalOnevent(packet);
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connection timeout')), ENV.SOCKET_TIMEOUT);
      this.socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      if (!this.socket.connected) this.socket.connect();
    });
  }

  joinHotel(hotelId: string): void {
    this.socket.emit('join_hotel', hotelId);
  }

  async waitForEvent(eventName: string, timeoutMs = ENV.SOCKET_TIMEOUT): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off(eventName, handler);
        reject(new Error(`Timeout waiting for event: ${eventName}`));
      }, timeoutMs);

      const handler = (data: unknown) => {
        clearTimeout(timer);
        resolve(data);
      };
      this.socket.once(eventName, handler);
    });
  }

  on(eventName: string, handler: (data: unknown) => void): void {
    this.socket.on(eventName, handler);
  }

  emit(eventName: string, data?: unknown): void {
    this.socket.emit(eventName, data);
  }

  getEvents(name?: string): SocketEvent[] {
    if (name) return this.events.filter(e => e.name === name);
    return [...this.events];
  }

  clearEvents(): void {
    this.events = [];
  }

  isConnected(): boolean {
    return this.socket.connected;
  }

  getId(): string {
    return this.socket.id || '';
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}

export async function createConnectedSocket(token?: string, hotelId?: string): Promise<TestSocket> {
  const sock = new TestSocket(token);
  await sock.connect();
  if (hotelId) {
    sock.joinHotel(hotelId);
    await new Promise(r => setTimeout(r, 200));
  }
  return sock;
}

export async function createMultipleSockets(
  count: number,
  token?: string,
  hotelId?: string
): Promise<TestSocket[]> {
  const sockets: TestSocket[] = [];
  for (let i = 0; i < count; i++) {
    const sock = await createConnectedSocket(token, hotelId);
    sockets.push(sock);
  }
  return sockets;
}

export function disconnectAll(sockets: TestSocket[]): void {
  sockets.forEach(s => s.disconnect());
}
