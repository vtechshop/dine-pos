import { GeminiProvider } from './GeminiProvider';
import { resolveGeminiModel } from './modelResolver';
import type { AIProvider } from './AIProvider';

export type { AIProvider, MenuExtractionResult, ExtractedCategory, ExtractedProduct } from './AIProvider';

let _provider: AIProvider | null = null;

export async function getAIProvider(): Promise<AIProvider> {
  if (_provider) return _provider;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const model = await resolveGeminiModel(apiKey);
  _provider = new GeminiProvider(apiKey, model);
  return _provider;
}
