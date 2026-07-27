// ── AI Provider abstraction ────────────────────────────────────────────────────
// New providers (OpenAI, Claude, Azure OpenAI) implement this interface without
// touching any route or UI code.

export interface ExtractedProduct {
  name:        string;
  price:       number | null;
  variant:     string;       // 'half' | 'full' | ''
  veg:         boolean;
  gst:         number | null;
  description: string;
  confidence:  number;       // 0.0–1.0
}

export interface ExtractedCategory {
  name:     string;
  products: ExtractedProduct[];
}

export interface MenuExtractionResult {
  restaurantName: string;
  categories:     ExtractedCategory[];
}

export interface AIProvider {
  readonly providerName: string;
  extractMenu(
    buffer:   Buffer,
    mimeType: string,
  ): Promise<MenuExtractionResult>;
}
