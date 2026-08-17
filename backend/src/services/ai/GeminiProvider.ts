import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import type {
  AIProvider, MenuExtractionResult,
  ExtractedVariant, ExtractedModifierGroup, ExtractedModifierOption,
} from './AIProvider';

// Files > 3 MB are sent via the Gemini File API instead of inline base64,
// which has an effective raw limit of ~3 MB before base64 encoding overhead.
const INLINE_LIMIT_BYTES = 3 * 1024 * 1024;

const EXTRACTION_PROMPT = `
You are a menu data extraction assistant for a restaurant POS system.
Analyse the menu document and extract every category, product, variant, and modifier group.

STRICT RULES:
1. Extract ONLY what is explicitly printed. Never invent prices, names, or options.
2. Do NOT guess prices. Use null for an unclear base price; 0 for a modifier option with no extra charge.
3. confidence: 1.0 = crystal-clear text, 0.5 = partially readable, 0.0 = unreadable.
4. veg: true for vegetarian / plant-based items, false for non-vegetarian and unknown.
5. gst: the explicit GST % printed for this item; null if not shown.
6. description: any description text printed with the item; "" if absent.
7. hsnCode: the HSN/SAC code printed for the item; "" if absent.
8. shortCode: any short code / item code printed for the item; "" if absent.
9. Group products under the category heading they appear beneath on the menu.
10. restaurantName: extract if visible on the page; "" if absent.

VARIANTS (portions or sizes each with their own price):
- If a product lists 2+ portions each with a price (e.g. "Half ₹80 / Full ₹150"), extract each as a variant.
- variants: [{ "name": "Half", "price": 80 }, { "name": "Full", "price": 150 }]
- Set base "price" to the lowest variant price.
- Common names: Half, Full, Quarter, Small, Medium, Large, Regular, Family.
- If no multi-price portions exist, set variants: [].

MODIFIER GROUPS (add-ons, extras, choices):
- Extract optional or required add-ons that appear below a product or in a dedicated section.
- Examples:
  "Extra Cheese ₹20, Extra Sauce ₹10"
    → { "name": "Add-ons", "required": false, "selectionType": "multi",
        "options": [{ "name": "Extra Cheese", "price": 20 }, { "name": "Extra Sauce", "price": 10 }] }
  "Spice Level: Mild / Medium / Hot (no extra charge)"
    → { "name": "Spice Level", "required": false, "selectionType": "single",
        "options": [{ "name": "Mild", "price": 0 }, { "name": "Medium", "price": 0 }, { "name": "Hot", "price": 0 }] }
  "Choose Base (mandatory): Roti / Rice"
    → { "name": "Choose Base", "required": true, "selectionType": "single",
        "options": [{ "name": "Roti", "price": 0 }, { "name": "Rice", "price": 0 }] }
- required: true only if the menu explicitly marks the choice as mandatory.
- If no modifiers for this product, set modifierGroups: [].

Return ONLY valid JSON matching this exact schema — no markdown fences, no extra text:
{
  "restaurantName": "",
  "categories": [
    {
      "name": "Category Name",
      "products": [
        {
          "name": "Product Name",
          "price": 80,
          "variants": [
            { "name": "Half", "price": 80 },
            { "name": "Full", "price": 150 }
          ],
          "modifierGroups": [
            {
              "name": "Add-ons",
              "required": false,
              "selectionType": "multi",
              "options": [
                { "name": "Extra Cheese", "price": 20 }
              ]
            }
          ],
          "veg": true,
          "gst": null,
          "hsnCode": "",
          "shortCode": "",
          "description": "",
          "confidence": 0.95
        }
      ]
    }
  ]
}
`.trim();

// ── Output normalisation ───────────────────────────────────────────────────────
// Gemini output is structured, but we never trust it blindly — normalise every
// field to the expected type so downstream validation doesn't have to.

function normaliseVariants(raw: unknown): ExtractedVariant[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .filter(v => String(v.name ?? '').trim())
    .map(v => ({ name: String(v.name).trim(), price: Math.max(0, Number(v.price ?? 0)) }));
}

function normaliseModifierOptions(raw: unknown): ExtractedModifierOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
    .filter(o => String(o.name ?? '').trim())
    .map(o => ({ name: String(o.name).trim(), price: Math.max(0, Number(o.price ?? 0)) }));
}

function normaliseModifierGroups(raw: unknown): ExtractedModifierGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g): g is Record<string, unknown> => typeof g === 'object' && g !== null)
    .filter(g => String(g.name ?? '').trim())
    .map(g => ({
      name:          String(g.name).trim(),
      required:      Boolean(g.required),
      selectionType: (g.selectionType === 'multi' ? 'multi' : 'single') as 'single' | 'multi',
      options:       normaliseModifierOptions(g.options),
    }))
    .filter(g => g.options.length > 0);
}

function normaliseResult(parsed: unknown): MenuExtractionResult {
  const r = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
  return {
    restaurantName: String(r.restaurantName ?? ''),
    categories: (Array.isArray(r.categories) ? r.categories : [])
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
      .filter(c => String(c.name ?? '').trim())
      .map(c => ({
        name:     String(c.name).trim(),
        products: (Array.isArray(c.products) ? c.products : [])
          .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
          .filter(p => String(p.name ?? '').trim())
          .map(p => ({
            name:           String(p.name).trim(),
            price:          p.price !== null && p.price !== undefined ? Number(p.price) : null,
            variants:       normaliseVariants(p.variants),
            modifierGroups: normaliseModifierGroups(p.modifierGroups),
            veg:            p.veg !== false,
            gst:            p.gst !== null && p.gst !== undefined ? Number(p.gst) : null,
            hsnCode:        String(p.hsnCode ?? ''),
            shortCode:      String(p.shortCode ?? ''),
            description:    String(p.description ?? ''),
            confidence:     Math.min(1, Math.max(0, Number(p.confidence ?? 0.8))),
          })),
      })),
  };
}

function stripMarkdown(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function parseAndNormalise(raw: string): MenuExtractionResult {
  const cleaned = stripMarkdown(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
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
  return normaliseResult(parsed);
}

// ── GeminiProvider ─────────────────────────────────────────────────────────────

export class GeminiProvider implements AIProvider {
  readonly providerName = 'gemini';

  private readonly client:      GoogleGenerativeAI;
  private readonly fileManager: GoogleAIFileManager;
  private readonly modelId:     string;

  constructor(apiKey: string, modelId: string) {
    this.client      = new GoogleGenerativeAI(apiKey);
    this.fileManager = new GoogleAIFileManager(apiKey);
    this.modelId     = modelId;
  }

  async extractMenu(buffer: Buffer, mimeType: string): Promise<MenuExtractionResult> {
    if (buffer.length > INLINE_LIMIT_BYTES) {
      return this.extractViaFileAPI(buffer, mimeType);
    }
    return this.extractInline(buffer, mimeType);
  }

  // ── Inline (< 3 MB) ─────────────────────────────────────────────────────────

  private async extractInline(buffer: Buffer, mimeType: string): Promise<MenuExtractionResult> {
    const model = this.getModel();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const result = await model.generateContent(
        {
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { data: buffer.toString('base64'), mimeType } },
              { text: EXTRACTION_PROMPT },
            ],
          }],
        },
        { signal: controller.signal },
      );
      clearTimeout(timer);
      return parseAndNormalise(result.response.text());
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Gemini request timed out after 90 seconds');
      }
      throw err;
    }
  }

  // ── File API (≥ 3 MB) — uploads to Gemini storage, uses fileData reference ──

  private async extractViaFileAPI(buffer: Buffer, mimeType: string): Promise<MenuExtractionResult> {
    let uploadedFileName: string | null = null;
    try {
      const upload = await this.fileManager.uploadFile(buffer, {
        mimeType,
        displayName: 'restaurant-menu',
      });
      uploadedFileName = upload.file.name;

      // Wait for the file to reach ACTIVE state (usually instant for PDFs)
      let fileInfo = await this.fileManager.getFile(uploadedFileName);
      let attempts = 0;
      while (fileInfo.state === FileState.PROCESSING && attempts < 20) {
        await new Promise(r => setTimeout(r, 2_000));
        fileInfo = await this.fileManager.getFile(uploadedFileName);
        attempts++;
      }
      if (fileInfo.state !== FileState.ACTIVE) {
        throw new Error(`Gemini file did not reach ACTIVE state (state: ${fileInfo.state})`);
      }

      const model = this.getModel();
      const controller = new AbortController();
      // Allow 2 min for large files — they're already uploaded, this is just inference
      const timer = setTimeout(() => controller.abort(), 120_000);
      try {
        const result = await model.generateContent(
          {
            contents: [{
              role: 'user',
              parts: [
                { fileData: { mimeType, fileUri: upload.file.uri } },
                { text: EXTRACTION_PROMPT },
              ],
            }],
          },
          { signal: controller.signal },
        );
        clearTimeout(timer);
        return parseAndNormalise(result.response.text());
      } catch (err: unknown) {
        clearTimeout(timer);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('Gemini request timed out after 120 seconds');
        }
        throw err;
      }
    } finally {
      // Always delete the uploaded file from Gemini storage — fire and forget
      if (uploadedFileName) {
        this.fileManager.deleteFile(uploadedFileName).catch(() => {});
      }
    }
  }

  private getModel() {
    return this.client.getGenerativeModel(
      {
        model: this.modelId,
        generationConfig: {
          temperature:      0.1,
          responseMimeType: 'application/json',
        },
      },
      { apiVersion: 'v1' },
    );
  }
}
