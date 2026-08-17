// ── AI Provider abstraction ────────────────────────────────────────────────────
// New providers (OpenAI, Claude, Azure OpenAI) implement this interface without
// touching any route or UI code.

export interface ExtractedVariant {
  name:  string;
  price: number;
}

export interface ExtractedModifierOption {
  name:  string;
  price: number;
}

export interface ExtractedModifierGroup {
  name:          string;
  required:      boolean;
  selectionType: 'single' | 'multi';
  options:       ExtractedModifierOption[];
}

export interface ExtractedProduct {
  name:           string;
  price:          number | null;
  variants:       ExtractedVariant[];
  modifierGroups: ExtractedModifierGroup[];
  veg:            boolean;
  gst:            number | null;
  hsnCode:        string;
  shortCode:      string;
  description:    string;
  confidence:     number;       // 0.0–1.0
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
