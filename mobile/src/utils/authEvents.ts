// Zero-import pub/sub — avoids circular dependency between api.ts and AuthContext.
// api.ts calls emitSessionExpired(); AuthContext registers the logout handler.

type SessionExpiredHandler = () => Promise<void>;

let _handler: SessionExpiredHandler | null = null;

export const registerSessionExpiredHandler = (handler: SessionExpiredHandler): void => {
  _handler = handler;
};

export const emitSessionExpired = async (): Promise<void> => {
  if (_handler) {
    try { await _handler(); } catch {}
  }
};
