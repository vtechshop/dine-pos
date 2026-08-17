/**
 * Dine POS — Design Tokens (TypeScript)
 * Single source of truth for React Native + web (non-CSS contexts).
 *
 * Usage (React Native):
 *   import { Colors, Spacing, Radius } from '../../tokens/tokens';
 *
 * Usage (web utility):
 *   import { Colors } from '../../tokens/tokens';
 */

export const Colors = {
  // Brand
  brand:        '#E8380D',
  brandLight:   '#FF5E36',
  brandDark:    '#C93008',
  amber:        '#FFA500',
  amberLight:   '#FFC02A',
  amberDark:    '#E08500',

  // Neutral scale
  n0:   '#FFFFFF',
  n50:  '#FFF6EE',
  n100: '#F5EDE4',
  n200: '#EBD8C8',
  n300: '#D4B5A0',
  n400: '#B89278',
  n500: '#9A6E55',
  n600: '#7A4F3A',
  n700: '#5C3322',
  n800: '#3C1C0E',
  n900: '#1C0800',

  // Semantic
  success:     '#22C55E',
  successDark: '#16A34A',
  successBg:   '#F0FDF4',
  danger:      '#C62828',
  dangerDark:  '#B71C1C',
  dangerBg:    '#FFF1EE',
  warning:     '#E65100',
  warningDark: '#C84600',
  warningBg:   '#FFF7ED',
  info:        '#3B82F6',
  infoDark:    '#2563EB',
  infoBg:      '#EFF6FF',

  // Light-mode surfaces (default)
  bg:        '#FFF6EE',
  surface:   '#FFFFFF',
  surface2:  '#F5EDE4',
  border:    '#EBD8C8',
  text:      '#1C0800',
  textSecondary: '#7A4F3A',
  textMuted: '#B89278',

  // Dark-mode surfaces
  darkBg:        '#120800',
  darkSurface:   '#1E0E06',
  darkSurface2:  '#2A1810',
  darkBorder:    '#3A2010',
  darkText:      '#F5EDE4',
  darkTextSecondary: '#C4A090',
  darkTextMuted: '#6A4030',

  // Convenience aliases (React Native common names)
  primary:   '#E8380D',
  secondary: '#FFA500',
  white:     '#FFFFFF',
  black:     '#1C0800',
} as const;

export const Spacing = {
  xs:    4,
  sm:    8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  24,
  xxxl: 32,
  jumbo: 48,
} as const;

export const Radius = {
  xs:   4,
  sm:   6,
  md:  10,
  lg:  14,
  xl:  20,
  pill: 999,
} as const;

export const FontFamily = {
  sans: 'System',   // Maps to system font on each platform
  mono: 'monospace',
} as const;

export const FontSize = {
  hero:    46,
  display: 32,
  title:   22,
  heading: 17,
  body:    14,
  small:   12,
  caption: 10,
} as const;

export const FontWeight = {
  regular: '400',
  medium:  '500',
  semibold:'600',
  bold:    '700',
  extrabold:'800',
  black:   '900',
} as const;

export type ColorKey = keyof typeof Colors;
export type SpacingKey = keyof typeof Spacing;
export type RadiusKey = keyof typeof Radius;
