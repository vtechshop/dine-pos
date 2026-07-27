import { GeminiProvider } from './GeminiProvider';
import type { AIProvider } from './AIProvider';

export type { AIProvider, MenuExtractionResult, ExtractedCategory, ExtractedProduct } from './AIProvider';

let _provider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (_provider) return _provider;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  _provider = new GeminiProvider(apiKey, process.env.GEMINI_MODEL);
  return _provider;
}
