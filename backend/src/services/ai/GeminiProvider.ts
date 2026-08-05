import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIProvider, MenuExtractionResult } from './AIProvider';

// Set GEMINI_MODEL env var to override
const DEFAULT_MODEL = 'gemini-2.5-flash-preview-05-20';

const EXTRACTION_PROMPT = `
You are a menu data extraction assistant for a restaurant POS system.
Analyse the menu document provided and extract every category and product.

STRICT RULES:
1. Extract ONLY what is explicitly printed in the menu. Never invent.
2. Do NOT guess prices. If a price is unclear or missing, set price to null.
3. confidence: 1.0 = crystal-clear, 0.5 = somewhat readable, 0.0 = unreadable.
4. veg: true for vegetarian / plant-based items, false for all others.
5. variant: "half" or "full" when the menu shows portion variants; otherwise "".
6. gst: the explicit GST % printed on the menu; null if not shown.
7. description: any printed description text for the item; "" if absent.
8. Group products under the category heading they appear beneath on the menu.
9. If the restaurant name is visible, include it; otherwise "".

Return ONLY the following JSON — no markdown, no explanation:
{
  "restaurantName": "",
  "categories": [
    {
      "name": "",
      "products": [
        {
          "name": "",
          "price": 0,
          "variant": "",
          "veg": true,
          "gst": null,
          "description": "",
          "confidence": 0.95
        }
      ]
    }
  ]
}
`.trim();

function stripMarkdown(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseGeminiJSON(raw: string): MenuExtractionResult {
  const cleaned = stripMarkdown(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Last-resort: try to extract a JSON object from the response
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini returned no parseable JSON');
    parsed = JSON.parse(match[0]);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).categories)
  ) {
    throw new Error('Gemini response does not match expected MenuExtractionResult shape');
  }

  return parsed as MenuExtractionResult;
}

export class GeminiProvider implements AIProvider {
  readonly providerName = 'gemini';

  private readonly client: GoogleGenerativeAI;
  private readonly modelId: string;

  constructor(apiKey: string, modelId: string = DEFAULT_MODEL) {
    this.client  = new GoogleGenerativeAI(apiKey);
    this.modelId = modelId;
  }

  async extractMenu(buffer: Buffer, mimeType: string): Promise<MenuExtractionResult> {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      generationConfig: {
        temperature:      0.1,
        responseMimeType: 'application/json',
      },
    });

    const imagePart = {
      inlineData: {
        data:     buffer.toString('base64'),
        mimeType,
      },
    };

    // 90-second timeout for large PDFs
    const timeoutMs = 90_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [imagePart, { text: EXTRACTION_PROMPT }],
          },
        ],
      });
      clearTimeout(timer);

      const raw  = result.response.text();
      return parseGeminiJSON(raw);
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Gemini request timed out after 90 seconds');
      }
      throw err;
    }
  }
}
