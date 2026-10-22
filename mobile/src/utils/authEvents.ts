// Zero-import pub/sub — avoids circular dependency between api.ts and AuthContext.
// api.ts calls emitSessionExpired(); AuthContext registers the logout handler.
// AuthContext calls emitAuthReady(); syncEngine registers to trigger a cache refresh.

type SessionExpiredHandler = () => Promise<void>;
type AuthReadyHandler = () => void;

let _handler: SessionExpiredHandler | null = null;
let _authReadyHandler: AuthReadyHandler | null = null;

export const registerSessionExpiredHandler = (handler: SessionExpiredHandler): void => {
  _handler = handler;
};

export const emitSessionExpired = async (): Promise<void> => {
  if (_handler) {
    try { await _handler(); } catch {}
  }
};

export const registerAuthReadyHandler = (handler: AuthReadyHandler): void => {
  _authReadyHandler = handler;
};

export const emitAuthReady = (): void => {
  if (_authReadyHandler) {
    try { _authReadyHandler(); } catch {}
  }
};
