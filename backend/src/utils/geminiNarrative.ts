import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import type { FunctionCall } from '@google/generative-ai';
import { resolveGeminiModel } from '../services/ai/modelResolver';
import { logger } from './logger';

// 45-second hard cap — Gemini SDK has no built-in request timeout.
// Beyond this, the caller's Express slot would be held indefinitely.
const GEMINI_TIMEOUT_MS = 45_000;

let gemini: GoogleGenerativeAI | null = null;
let cachedModel: GenerativeModel | null = null;

async function getModel(): Promise<GenerativeModel | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  if (cachedModel) return cachedModel;
  if (!gemini) gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = await resolveGeminiModel(process.env.GEMINI_API_KEY);
  cachedModel = gemini.getGenerativeModel({ model }, { apiVersion: 'v1' });
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
  const model = await getModel();
  if (!model) return null;

  try {
    const result = await geminiTimeout(model.generateContent(prompt));
    return result.response.text() || null;
  } catch (err) {
    logger.warn('[geminiNarrative] generation failed', { err: String(err) });
    return null;
  }
}

// ─── Tool call types for function calling ────────────────────────────────────

export interface ToolDeclaration {
  name:        string;
  description: string;
  parameters:  {
    type:       'object';
    properties: Record<string, { type: string; description: string }>;
    required?:  string[];
  };
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

// ─── generateWithTools ────────────────────────────────────────────────────────
// Multi-turn Gemini with function calling.
// hotelId is NEVER exposed to Gemini — executor receives it via closure.
// Max 3 tool-call rounds to prevent runaway costs.

const MAX_TOOL_ROUNDS   = 3;
const TOOL_TIMEOUT_MS   = 15_000;

export async function generateWithTools(
  initialPrompt: string,
  tools:          ToolDeclaration[],
  executor:       ToolExecutor,
): Promise<string | null> {
  const model = await getModel();
  if (!model) return null;

  // Build Gemini tool declarations
  const geminiTools = [{
    functionDeclarations: tools.map((t) => ({
      name:        t.name,
      description: t.description,
      parameters:  t.parameters as any,
    })),
  }];

  // Build model with tools
  const toolModel = (model as any).model
    ? model  // already resolved
    : model;

  const contents: Array<{ role: string; parts: Array<{ text?: string; functionCall?: FunctionCall; functionResponse?: { name: string; response: unknown } }> }> = [
    { role: 'user', parts: [{ text: initialPrompt }] },
  ];

  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    let result: any;
    try {
      result = await geminiTimeout(
        (toolModel as any).generateContent({ contents, tools: geminiTools }),
      );
    } catch (err) {
      logger.warn('[geminiNarrative] generateWithTools failed at round ' + round, { err: String(err) });
      return null;
    }

    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate) return null;

    // Check if Gemini wants to call a function
    const functionCalls: FunctionCall[] = candidate.content?.parts
      ?.filter((p: any) => p.functionCall)
      ?.map((p: any) => p.functionCall) ?? [];

    if (functionCalls.length === 0) {
      // No function calls — return the text response
      return response.text() || null;
    }

    // Append Gemini's function-call turn
    contents.push({
      role: 'model',
      parts: functionCalls.map((fc: any) => ({ functionCall: fc })),
    });

    // Execute all function calls (max 5 per round to cap cost)
    const toolResponses = await Promise.all(
      functionCalls.slice(0, 5).map(async (fc: any) => {
        let toolResult: Record<string, unknown>;
        try {
          toolResult = await Promise.race([
            executor(fc.name, fc.args ?? {}),
            new Promise<Record<string, unknown>>((_, reject) =>
              setTimeout(() => reject(new Error('Tool timeout')), TOOL_TIMEOUT_MS),
            ),
          ]);
        } catch (toolErr) {
          toolResult = { error: `Tool failed: ${String(toolErr)}` };
        }
        return { name: fc.name, response: toolResult };
      }),
    );

    // Append tool results turn
    contents.push({
      role: 'user',
      parts: toolResponses.map((r) => ({
        functionResponse: { name: r.name, response: r.response },
      })),
    });

    round++;
  }

  // Exceeded max rounds — ask for a final text response
  logger.warn('[geminiNarrative] max tool rounds reached, requesting final text');
  contents.push({ role: 'user', parts: [{ text: 'Please provide your final answer based on the tool results above.' }] });

  try {
    const finalResult = await geminiTimeout((toolModel as any).generateContent({ contents })) as any;
    return finalResult.response.text() || null;
  } catch {
    return null;
  }
}
