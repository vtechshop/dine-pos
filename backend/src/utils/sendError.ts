import { Response } from 'express';
import { logger } from './logger';

/**
 * Send an error response. In production, the raw error object is never
 * included in the response body to avoid leaking internals. The full
 * error is always logged server-side.
 */
export const sendError = (
  res: Response,
  status: number,
  message: string,
  err?: unknown,
): void => {
  if (err !== undefined) {
    logger.error(message, { err: String(err), status });
  }
  res.status(status).json({ success: false, message });
};
