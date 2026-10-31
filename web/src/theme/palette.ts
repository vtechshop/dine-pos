/**
 * Theme colours as hex, for places that need a literal colour string (chart libraries,
 * canvas, QR). Keep in step with the CSS variables in src/index.css.
 */
export const PALETTE = {
  burgundy: '#641E32',
  wine:     '#8E354B',
  coral:    '#F16B65',
  blush:    '#FFAAA5',
  petal:    '#FCE4E1',
  cream:    '#F5EBDD',
  ivory:    '#FFFCF7',
  ink:      '#33252A',
  muted:    '#806D70',
  border:   '#E8D9CC',
  success:  '#43866A',
  warning:  '#D49A43',
  danger:   '#C84C54',
} as const;

/** Series colours for charts, in order of use. */
export const CHART_COLORS = [
  PALETTE.burgundy,
  PALETTE.coral,
  PALETTE.blush,
  PALETTE.wine,
  '#B8868F',          // dusty rose (muted complement)
  PALETTE.warning,
  PALETTE.success,
  PALETTE.muted,
] as const;
