import { apiFetch } from './client';

export interface ChatMessage {
  role:      'user' | 'assistant';
  content:   string;
  timestamp: string;
}

export interface ChatResponse {
  sessionId:    string;
  reply:        string;
  timestamp:    string;
  isNewSession: boolean;
  contextAge:   'cache' | 'fresh';
}

export interface ChatHistoryResponse {
  sessionId: string;
  messages:  ChatMessage[];
}

export interface ChatSessionsResponse {
  sessions: string[];
}

export function sendChatMessage(message: string, sessionId?: string): Promise<ChatResponse> {
  return apiFetch('/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function fetchChatHistory(sessionId: string): Promise<ChatHistoryResponse> {
  return apiFetch(`/ai/chat/history?sessionId=${encodeURIComponent(sessionId)}`);
}

export function clearChatHistory(sessionId: string): Promise<{ success: boolean; sessionId: string }> {
  return apiFetch(`/ai/chat/history?sessionId=${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

export function fetchChatSessions(): Promise<ChatSessionsResponse> {
  return apiFetch('/ai/chat/sessions');
}
