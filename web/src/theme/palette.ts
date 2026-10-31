/**
 * Theme colours as hex, for places that need a literal colour string (chart libraries,
 * canvas, QR). Keep in step with the CSS variables in src/index.css.
 */
export const PALETTE = {
  espresso: '#805A3B',
  coffee:   '#4A3325',
  mocha:    '#A17B5C',
  ivory:    '#F5F1EA',
  beige:    '#EAE3D9',
  page:     '#F3F0EB',
  card:     '#FFFFFF',
  ink:      '#35291F',
  muted:    '#91877E',
  border:   '#E5DED5',
  success:  '#4F8A70',
  warning:  '#D5A04C',
  danger:   '#D85D5D',
} as const;

/** Series colours for charts, in order of use. */
export const CHART_COLORS = [
  PALETTE.espresso,
  PALETTE.coffee,
  PALETTE.mocha,
  '#C9B79F',          // latte
  '#6F7F8C',          // slate (calm contrast to the browns)
  PALETTE.warning,
  PALETTE.success,
  PALETTE.muted,
] as const;
