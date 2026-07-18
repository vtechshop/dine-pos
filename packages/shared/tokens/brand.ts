// Single source of truth for Dine POS brand colours.
// Import in tailwind.config.js and in any component that needs the raw value.

export const brand = {
  accent: '#E8380D',  // primary orange-red — buttons, CTAs, active states
  dark:   '#1C0800',  // near-black         — sidebar, topbar backgrounds
  cream:  '#FFF6EE',  // warm cream          — main content backgrounds
  border: '#E8D5C0',  // border/divider
} as const;

export type BrandKey = keyof typeof brand;
