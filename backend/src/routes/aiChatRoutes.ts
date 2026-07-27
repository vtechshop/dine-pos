import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  processChat,
  getChatHistory,
  deleteChatHistory,
  listChatSessions,
} from '../services/aiChat';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
// Send a message to the AI business assistant.
// Body: { message: string, sessionId?: string }
// If sessionId is omitted, a new session is created and returned.
// Gemini consumes ONLY the pre-built business context + conversation history.

router.post('/chat', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const { message, sessionId } = req.body as { message?: unknown; sessionId?: unknown };

    if (typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ message: 'message is required and must be a non-empty string' });
    }

    if (message.trim().length > 2000) {
      return res.status(400).json({ message: 'message must not exceed 2000 characters' });
    }

    const sid = typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : undefined;

    const result = await processChat(hotelId, sid, message.trim());
    return res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to process chat message', err);
  }
});

// ─── GET /api/ai/chat/history ─────────────────────────────────────────────────
// Returns conversation history for a session.
// Query: ?sessionId=<uuid>

router.get('/chat/history', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId   = req.hotelId!;
    const sessionId = req.query.sessionId as string | undefined;

    if (!sessionId || sessionId.trim().length === 0) {
      return res.status(400).json({ message: 'sessionId query parameter is required' });
    }

    const result = await getChatHistory(hotelId, sessionId.trim());
    return res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to retrieve chat history', err);
  }
});

// ─── DELETE /api/ai/chat/history ──────────────────────────────────────────────
// Clears conversation history for a session.
// Query: ?sessionId=<uuid>

router.delete('/chat/history', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId   = req.hotelId!;
    const sessionId = req.query.sessionId as string | undefined;

    if (!sessionId || sessionId.trim().length === 0) {
      return res.status(400).json({ message: 'sessionId query parameter is required' });
    }

    await deleteChatHistory(hotelId, sessionId.trim());
    return res.json({ success: true, sessionId: sessionId.trim() });
  } catch (err) {
    sendError(res, 500, 'Failed to clear chat history', err);
  }
});

// ─── GET /api/ai/chat/sessions ────────────────────────────────────────────────
// Lists all active session IDs for this hotel.

router.get('/chat/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId  = req.hotelId!;
    const sessions = await listChatSessions(hotelId);
    return res.json({ sessions });
  } catch (err) {
    sendError(res, 500, 'Failed to list chat sessions', err);
  }
});

export default router;
