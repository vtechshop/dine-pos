// ─── AI Business Assistant — Chat Service ────────────────────────────────────
// Orchestrates: context build → history load → Gemini prompt → history write.
// Gemini NEVER calculates KPIs. All numbers come from the pre-built context.

import { randomUUID } from 'crypto';
import { generateWithTools, ToolDeclaration } from '../utils/geminiNarrative';
import { executeTool, AVAILABLE_TOOLS } from './chatTools';
import { buildBusinessContext } from './contextBuilder';
import {
  getCachedContext,
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
3. If a metric is not in the context, use the available tools to look it up. Only say "I don't have that data" if no tool can answer it.
4. Keep answers concise (3–5 sentences), specific, and actionable.
5. Always cite the specific number you're referencing.
6. For operational questions outside the data (recipes, staff schedules, etc.), decline politely and redirect to the business data you do have.`;

// ─── Tool declarations for Gemini function calling ───────────────────────────
// Parameter schemas NEVER include hotelId — it's always server-enforced.
const CHAT_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'getRevenue',
    description: 'Get revenue and order statistics for a date range. Use for revenue, sales, order count queries.',
    parameters: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'getOrders',
    description: 'Get detailed order statistics including hourly breakdown.',
    parameters: {
      type: 'object' as const,
      properties: {
        startDate:   { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:     { type: 'string', description: 'End date YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'getTopProducts',
    description: 'Get top selling products by revenue for a date range.',
    parameters: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
        limit:     { type: 'number', description: 'Max number of products (default 10, max 20)' },
      },
    },
  },
  {
    name: 'getLowStockItems',
    description: 'Get ingredients that are at or below their low stock threshold.',
    parameters: { type: 'object' as const, properties: {} },
  },
  {
    name: 'getVendorBalances',
    description: 'Get outstanding vendor payable balances.',
    parameters: { type: 'object' as const, properties: {} },
  },
  {
    name: 'getPaymentBreakdown',
    description: 'Get payment method breakdown (cash, UPI, card, split) for a date range.',
    parameters: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'getOnlineOrderMetrics',
    description: 'Get online platform order breakdown (Swiggy, Zomato, QR) for a date range.',
    parameters: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'getExpenses',
    description: 'Get expense totals by category for a date range.',
    parameters: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'getCancellations',
    description: 'Get order cancellation statistics and revenue lost for a date range.',
    parameters: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'getDiscounts',
    description: 'Get discount analysis for a date range — total discounts, discount rate, top discounted items.',
    parameters: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'getRefunds',
    description: 'Get refund statistics for a date range.',
    parameters: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'getCustomerMetrics',
    description: 'Get customer/guest statistics — repeat customers, new customers, loyalty points.',
    parameters: {
      type: 'object' as const,
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'getAlerts',
    description: 'Get active smart alerts for the hotel.',
    parameters: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: 'Date YYYY-MM-DD (default: today)' },
      },
    },
  },
];

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

  // ── Prompt injection protection ──────────────────────────────────────────────
  const INJECTION_PATTERNS = [
    /ignore (all )?(previous|prior|above) instructions/i,
    /you are now/i,
    /pretend (you are|to be)/i,
    /act as (a|an) /i,
    /system prompt/i,
    /reveal (your|the) (system|instructions|prompt)/i,
    /jailbreak/i,
    /\\n\\n(Human|User|Assistant):/i,
  ];
  const hasInjection = INJECTION_PATTERNS.some((p) => p.test(cleanMessage));
  if (hasInjection) {
    return {
      sessionId:    sid,
      reply:        "I can only help with restaurant business questions based on your actual data. How can I assist with your restaurant operations today?",
      timestamp:    now,
      isNewSession,
      contextAge:   'cache',
    };
  }

  // ── Load context + history in parallel ──────────────────────────────────
  // Check cache first so we can accurately report contextAge to the caller.
  const [cachedCtx, history] = await Promise.all([
    getCachedContext(hotelId),
    getHistory(hotelId, sid),
  ]);
  const contextAge: ChatResponse['contextAge'] = cachedCtx ? 'cache' : 'fresh';
  const context = cachedCtx ?? await buildBusinessContext(hotelId);

  // ── Build prompt and call Gemini with function calling ───────────────────
  const prompt = buildPrompt(context, history, cleanMessage);

  // The tool executor closes over hotelId from JWT — Gemini NEVER provides it
  const toolExecutor = (name: string, args: Record<string, unknown>) =>
    executeTool(name, hotelId, args);

  const reply = await generateWithTools(prompt, CHAT_TOOL_DECLARATIONS, toolExecutor);

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
