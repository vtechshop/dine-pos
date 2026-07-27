import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from './logger';

// Reuse the same model setting as the existing GeminiProvider
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

let gemini: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!gemini) gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return gemini;
}

/**
 * Generate a text narrative from a pre-structured prompt.
 * Returns null when GEMINI_API_KEY is absent or the API call fails,
 * allowing callers to degrade gracefully.
 */
export async function generateNarrative(prompt: string): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const model  = client.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);
    return result.response.text() || null;
  } catch (err) {
    logger.warn('[geminiNarrative] generation failed', { err: String(err) });
    return null;
  }
}
