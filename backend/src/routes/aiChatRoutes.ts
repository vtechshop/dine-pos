import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import {
  processChat,
  getChatHistory,
  deleteChatHistory,
  listChatSessions,
} from '../services/aiChat';
import { sendError } from '../utils/sendError';
import { requireAiQuota } from '../utils/aiUsageTracker';

const router = Router();
router.use(authMiddleware);
router.use(requireFeature('ai'));

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
// Send a message to the AI business assistant.
// Body: { message: string, sessionId?: string }
// If sessionId is omitted, a new session is created and returned.
// Gemini consumes ONLY the pre-built business context + conversation history.

router.post('/chat', requireAiQuota('chat'), async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const { message, sessionId } = req.body as { message?: unknown; sessionId?: unknown };

    if (typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ message: 'message is required and must be a non-empty string' });
    }

    if (message.trim().length > 2000) {
      return res.status(400).json({ message: 'message must not exceed 2000 characters' });
    }

    // Validate sessionId format if provided
    const rawSessionId = typeof req.body.sessionId === 'string' ? req.body.sessionId : undefined;
    if (rawSessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSessionId)) {
      return res.status(400).json({ message: 'Invalid sessionId format' });
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
