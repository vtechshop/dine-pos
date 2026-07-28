// ─── AI Business Assistant — Chat Service ────────────────────────────────────
// Orchestrates: context build → history load → Gemini prompt → history write.
// Gemini NEVER calculates KPIs. All numbers come from the pre-built context.

import { randomUUID } from 'crypto';
import { generateNarrative } from '../utils/geminiNarrative';
import { buildBusinessContext } from './contextBuilder';
import {
  getHistory,
  appendHistory,
  clearHistory,
  listSessions,
  StoredMessage,
} from '../utils/chatCache';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatResponse {
  sessionId:    string;
  reply:        string;
  timestamp:    string;
  isNewSession: boolean;
  contextAge:   'cache' | 'fresh';
}

export interface HistoryResponse {
  sessionId: string;
  messages:  StoredMessage[];
}

// ─── Prompt assembly ──────────────────────────────────────────────────────────
// Conversation history is embedded directly in the prompt (single-turn API).
// This avoids multi-turn chat session management while still giving Gemini
// full conversation context for follow-up questions.

const SYSTEM_INSTRUCTIONS = `You are DinePOS AI, an intelligent restaurant business advisor.

Core rules (non-negotiable):
1. NEVER calculate, estimate, or derive any business number yourself.
2. ONLY use metrics explicitly stated in the BUSINESS INTELLIGENCE CONTEXT block above.
3. If a metric is not in the context, say "I don't have that data right now."
4. Keep answers concise (3–5 sentences), specific, and actionable.
5. Always cite the specific number you're referencing.
6. For operational questions outside the data (recipes, staff schedules, etc.), decline politely and redirect to the business data you do have.`;

// Hard caps — gemini-2.5-flash supports 1M context but we cap well below
// to keep latency and cost predictable. Context is the biggest variable.
const MAX_CONTEXT_CHARS   = 3_500; // ~875 tokens
const MAX_HISTORY_MSG_CHARS = 400; // per message, prevents one large reply from dominating

function buildPrompt(
  context:    string,
  history:    StoredMessage[],
  userMessage: string,
): string {
  const truncatedContext = context.length > MAX_CONTEXT_CHARS
    ? context.slice(0, MAX_CONTEXT_CHARS) + '\n[context truncated]'
    : context;

  const parts: string[] = [truncatedContext, '', SYSTEM_INSTRUCTIONS];

  if (history.length > 0) {
    parts.push('', '--- CONVERSATION HISTORY ---');
    // Send last 10 messages (5 turns) to limit token usage
    const recent = history.slice(-10);
    for (const msg of recent) {
      const label = msg.role === 'user' ? 'User' : 'DinePOS AI';
      const content = msg.content.length > MAX_HISTORY_MSG_CHARS
        ? msg.content.slice(0, MAX_HISTORY_MSG_CHARS) + '...'
        : msg.content;
      parts.push(`${label}: ${content}`);
    }
    parts.push('--- END OF HISTORY ---');
  }

  parts.push('', `User: ${userMessage}`, '', 'DinePOS AI:');
  return parts.join('\n');
}

// ─── Main chat handler ────────────────────────────────────────────────────────

export async function processChat(
  hotelId:     string,
  sessionId:   string | undefined,
  userMessage: string,
): Promise<ChatResponse> {
  const now          = new Date().toISOString();
  const isNewSession = !sessionId;
  const sid          = sessionId || randomUUID();

  // Sanitize input — 2000 char limit
  const cleanMessage = userMessage.trim().slice(0, 2000);

  // ── Load context + history in parallel ──────────────────────────────────
  const [context, history] = await Promise.all([
    buildBusinessContext(hotelId),
    getHistory(hotelId, sid),
  ]);

  // Track if context came from cache (contextBuilder handles that internally;
  // we use a simple heuristic: if context already stored, it was from cache).
  const contextAge: ChatResponse['contextAge'] = 'cache'; // always "cache" from caller's POV since contextBuilder manages the TTL internally

  // ── Build prompt and call Gemini ─────────────────────────────────────────
  const prompt = buildPrompt(context, history, cleanMessage);
  const reply  = await generateNarrative(prompt);

  const assistantReply = reply ?? "I'm unable to respond right now. Please try again in a moment.";

  // ── Persist both messages to history ────────────────────────────────────
  const newMessages: StoredMessage[] = [
    { role: 'user',      content: cleanMessage,    timestamp: now },
    { role: 'assistant', content: assistantReply,  timestamp: new Date().toISOString() },
  ];
  await appendHistory(hotelId, sid, newMessages);

  return {
    sessionId:    sid,
    reply:        assistantReply,
    timestamp:    now,
    isNewSession,
    contextAge,
  };
}

// ─── History accessors ────────────────────────────────────────────────────────

export async function getChatHistory(
  hotelId:   string,
  sessionId: string,
): Promise<HistoryResponse> {
  const messages = await getHistory(hotelId, sessionId);
  return { sessionId, messages };
}

export async function deleteChatHistory(
  hotelId:   string,
  sessionId: string,
): Promise<void> {
  await clearHistory(hotelId, sessionId);
}

export async function listChatSessions(hotelId: string): Promise<string[]> {
  return listSessions(hotelId);
}
