import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import { Bot, X, Plus, Zap, Database } from 'lucide-react';
import {
  sendChatMessage,
  fetchChatHistory,
  clearChatHistory,
  fetchChatSessions,
  ChatMessage,
} from '../../api/aiChat';

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_CHARS = 2000;
const WARN_CHARS = 1800;

const SUGGESTIONS = [
  "What was yesterday's revenue?",
  'Which items are selling the most this week?',
  'Show me the cancellation trend',
  'What inventory needs reordering?',
  'Who is the top-performing cashier?',
  'What time should I staff up this weekend?',
] as const;

// ── Sub-components ─────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10">
        <Bot size={14} className="text-brand" />
      </div>
      <div className="rounded-2xl rounded-bl-sm border border-border bg-canvas px-4 py-3">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="h-2 w-2 rounded-full bg-ink/30 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface BubbleProps {
  msg: ChatMessage;
}

function MessageBubble({ msg }: BubbleProps) {
  const isUser = msg.role === 'user';
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`flex items-end gap-2 px-5 py-1.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="mb-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10">
          <Bot size={14} className="text-brand" />
        </div>
      )}
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={
            isUser
              ? 'rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-white max-w-[80%]'
              : 'rounded-2xl rounded-bl-sm border border-border bg-canvas px-4 py-2.5 text-sm text-ink max-w-[80%]'
          }
        >
          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
        </div>
        <span className="mt-1 text-[10px] text-ink/30">{time}</span>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ onSuggestion }: { onSuggestion: (s: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10">
          <Bot size={32} className="text-brand" />
        </div>
        <div>
          <h2 className="text-base font-bold text-ink">Ask me anything about your restaurant</h2>
          <p className="mt-1 text-sm text-ink/40">Powered by Gemini — your AI business analyst</p>
        </div>
      </div>
      <div className="flex w-full max-w-lg flex-wrap justify-center gap-2">
        {SUGGESTIONS.map(s => (
          <button
            key={s}
            onClick={() => onSuggestion(s)}
            className="rounded-full border border-border bg-canvas px-3.5 py-1.5 text-sm text-ink/70 transition-colors hover:border-brand/40 hover:bg-brand/5 hover:text-brand"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function AIChatPage() {
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [input, setInput]           = useState('');
  const [sending, setSending]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [contextAge, setContextAge] = useState<'cache' | 'fresh' | null>(null);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const scrollRef  = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages or sending state changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // On mount: load most recent session if any
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { sessions } = await fetchChatSessions();
        if (cancelled || sessions.length === 0) return;
        const latest = sessions[0];
        const history = await fetchChatHistory(latest);
        if (cancelled) return;
        setSessionId(latest);
        setMessages(history.messages);
      } catch {
        // Non-fatal — start fresh
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSend = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    if (content.length > MAX_CHARS) return;

    setInput('');
    setError(null);

    const userMsg: ChatMessage = {
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    try {
      const res = await sendChatMessage(content, sessionId ?? undefined);
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: res.reply,
        timestamp: res.timestamp,
      };
      setMessages(prev => [...prev, assistantMsg]);
      setSessionId(res.sessionId);
      setContextAge(res.contextAge);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(msg);
      // Remove the optimistic user message on failure
      setMessages(prev => prev.slice(0, -1));
      setInput(content);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [input, sending, sessionId]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const handleClear = useCallback(async () => {
    if (!sessionId) return;
    try {
      await clearChatHistory(sessionId);
    } catch {
      // Ignore — clear locally regardless
    }
    setMessages([]);
    setSessionId(null);
    setContextAge(null);
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [sessionId]);

  const charCount = input.length;
  const overLimit = charCount > MAX_CHARS;
  const nearLimit = charCount >= WARN_CHARS && !overLimit;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10">
              <Bot size={16} className="text-brand" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-ink">AI Chat</h1>
                {contextAge && (
                  <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    contextAge === 'cache'
                      ? 'bg-blue-50 text-blue-600'
                      : 'bg-green-50 text-green-600'
                  }`}>
                    {contextAge === 'cache'
                      ? <><Database size={9} /> cached</>
                      : <><Zap size={9} /> fresh</>
                    }
                  </span>
                )}
              </div>
              <p className="text-[11px] text-ink/40">Powered by Gemini</p>
            </div>
          </div>

          {(messages.length > 0 || sessionId) && (
            <button
              onClick={() => void handleClear()}
              disabled={sending}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-semibold text-ink/60 transition-colors hover:border-brand/30 hover:bg-mist hover:text-ink disabled:opacity-40"
            >
              <Plus size={12} /> New Chat
            </button>
          )}
        </div>
      </div>

      {/* ── Messages area ───────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !sending ? (
          <EmptyState onSuggestion={s => void handleSend(s)} />
        ) : (
          <div className="py-3">
            {messages.map((msg, i) => (
              <MessageBubble key={`${msg.role}-${i}-${msg.timestamp}`} msg={msg} />
            ))}
            {sending && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Error banner ────────────────────────────────────────────────────── */}
      {error && (
        <div className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-red-600">{error}</p>
            <button
              onClick={() => setError(null)}
              className="shrink-0 rounded p-0.5 text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors"
              aria-label="Dismiss error"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Input footer ────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border bg-canvas px-4 py-3">
        <form
          onSubmit={e => { e.preventDefault(); void handleSend(); }}
          className="flex items-end gap-2"
        >
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about sales, inventory, staff…"
              rows={1}
              disabled={sending}
              maxLength={MAX_CHARS + 10}
              className={`w-full resize-none rounded-xl border px-4 py-2.5 pr-16 text-sm text-ink placeholder:text-ink/30 outline-none transition-colors focus:ring-2 disabled:opacity-50 ${
                overLimit
                  ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
                  : 'border-border focus:border-brand focus:ring-brand/10'
              }`}
              style={{ maxHeight: '120px', overflowY: 'auto' }}
            />
            {(nearLimit || overLimit) && (
              <span className={`absolute bottom-2.5 right-3 text-[10px] font-semibold tabular-nums ${
                overLimit ? 'text-red-500' : 'text-amber-500'
              }`}>
                {charCount}/{MAX_CHARS}
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={sending || overLimit || charCount === 0}
            className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50 transition-colors"
          >
            Send
          </button>
        </form>
        <p className="mt-1.5 text-[10px] text-ink/25">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
