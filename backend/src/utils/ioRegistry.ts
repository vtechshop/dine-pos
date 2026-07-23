import type { Server } from 'socket.io';

let _io: Server | null = null;

export function setIo(instance: Server): void {
  _io = instance;
}

export function getIo(): Server | null {
  return _io;
}
