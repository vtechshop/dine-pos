import { TestSocket, createConnectedSocket, disconnectAll } from '../../utils/socket-client';

export interface SocketBundle {
  admin: TestSocket;
  kitchen: TestSocket;
  waiter: TestSocket;
  cashier: TestSocket;
}

export async function connectAllRoles(
  hotelId: string,
  tokens: { adminToken: string; kitchenToken: string; waiterToken: string; cashierToken: string }
): Promise<SocketBundle> {
  const [admin, kitchen, waiter, cashier] = await Promise.all([
    createConnectedSocket(tokens.adminToken, hotelId),
    createConnectedSocket(tokens.kitchenToken, hotelId),
    createConnectedSocket(tokens.waiterToken, hotelId),
    createConnectedSocket(tokens.cashierToken, hotelId),
  ]);
  return { admin, kitchen, waiter, cashier };
}

export function disconnectBundle(bundle: SocketBundle): void {
  disconnectAll([bundle.admin, bundle.kitchen, bundle.waiter, bundle.cashier]);
}

export async function waitForOrderEvent(
  socket: TestSocket,
  eventName: string,
  timeoutMs = 5000
): Promise<any> {
  return socket.waitForEvent(eventName, timeoutMs);
}

export async function waitForAnyOf(
  socket: TestSocket,
  eventNames: string[],
  timeoutMs = 5000
): Promise<{ event: string; data: unknown }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for any of: ${eventNames.join(', ')}`));
    }, timeoutMs);

    const cleanup: Array<() => void> = [];
    for (const ev of eventNames) {
      const handler = (data: unknown) => {
        clearTimeout(timer);
        cleanup.forEach(fn => fn());
        resolve({ event: ev, data });
      };
      socket.on(ev, handler);
    }
  });
}

export function assertSocketConnected(socket: TestSocket, label = 'socket'): void {
  if (!socket.isConnected()) {
    throw new Error(`Expected ${label} to be connected but it is not`);
  }
}
