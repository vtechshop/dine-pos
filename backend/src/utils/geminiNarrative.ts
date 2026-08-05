import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { logger } from './logger';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

// 45-second hard cap — Gemini SDK has no built-in request timeout.
// Beyond this, the caller's Express slot would be held indefinitely.
const GEMINI_TIMEOUT_MS = 45_000;

let gemini: GoogleGenerativeAI | null = null;
let cachedModel: GenerativeModel | null = null;

function getModel(): GenerativeModel | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!gemini) gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  if (!cachedModel) cachedModel = gemini.getGenerativeModel({ model: MODEL }, { apiVersion: 'v1' });
  return cachedModel;
}

function geminiTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Gemini timeout after ${GEMINI_TIMEOUT_MS}ms`)),
        GEMINI_TIMEOUT_MS,
      ),
    ),
  ]);
}

/**
 * Generate a text narrative from a pre-structured prompt.
 * Returns null when GEMINI_API_KEY is absent or the API call fails,
 * allowing callers to degrade gracefully.
 */
export async function generateNarrative(prompt: string): Promise<string | null> {
  const model = getModel();
  if (!model) return null;

  try {
    const result = await geminiTimeout(model.generateContent(prompt));
    return result.response.text() || null;
  } catch (err) {
    logger.warn('[geminiNarrative] generation failed', { err: String(err) });
    return null;
  }
}
