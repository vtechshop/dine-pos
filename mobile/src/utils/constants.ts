// API Base URL - change this to your backend server IP
export const API_BASE_URL = 'https://dine-pos.onrender.com/api';
export const UPI_ID = '7871469095@ybl';
export const UPI_NAME = 'Dine POS';

// ── Warm Restaurant Theme — KFC / Zomato inspired ─────────────────────────
// Light, vibrant, appetizing — like real fast food chains
export const Colors = {
  // ── Brand — spicy red-orange ──
  primary:       '#E8380D',   // hot sauce red
  primaryDark:   '#C23009',
  primaryLight:  '#FF5733',
  primaryGlow:   'rgba(232,56,13,0.18)',
  primaryBg:     'rgba(232,56,13,0.09)',

  // ── Accent — golden yellow (KFC gold / McDonald's yellow) ──
  accent:        '#FFA500',
  accentDark:    '#E07B00',
  accentGlow:    'rgba(255,165,0,0.18)',
  accentBg:      'rgba(255,165,0,0.10)',

  // ── Backgrounds (warm cream — like a restaurant interior) ──
  background:    '#FFF6EE',   // warm cream
  surface:       '#FFFFFF',   // pure white card
  card:          '#FFFAF5',   // very light orange tint
  cardHover:     '#1f1710',
  elevated:      '#FFE8CC',
  overlay:       'rgba(30,10,0,0.65)',

  // ── Borders ──
  border:        '#F0D9C8',
  borderLight:   '#F8EDE3',
  borderFocus:   '#E8380D',

  // ── Text ──
  text:          '#1C0800',   // very dark warm brown
  textSecondary: '#7A4F3A',   // medium warm brown
  textMuted:     '#C4A090',   // light warm

  // ── Status ──
  success:       '#2E7D32',
  successDark:   '#1B5E20',
  successGlow:   'rgba(46,125,50,0.18)',
  successBg:     'rgba(46,125,50,0.09)',
  danger:        '#C62828',
  dangerDark:    '#B71C1C',
  dangerGlow:    'rgba(198,40,40,0.18)',
  dangerBg:      'rgba(198,40,40,0.09)',
  warning:       '#E65100',
  warningBg:     'rgba(230,81,0,0.09)',
  info:          '#1565C0',
  infoBg:        'rgba(21,101,192,0.09)',

  // ── Food indicators (FSSAI) ──
  veg:           '#2E7D32',
  vegBg:         'rgba(46,125,50,0.12)',
  nonVeg:        '#B71C1C',
  nonVegBg:      'rgba(183,28,28,0.12)',

  // ── Payment ──
  cash:          '#2E7D32',
  cashBg:        'rgba(46,125,50,0.12)',
  upi:           '#6A1B9A',
  upiBg:         'rgba(106,27,154,0.12)',
  cardPayment:   '#1565C0',
  cardBg:        'rgba(21,101,192,0.12)',
  split:         '#E65100',
  splitBg:       'rgba(230,81,0,0.12)',

  // ── Order status ──
  statusPending:     '#E65100',
  statusPendingBg:   'rgba(230,81,0,0.12)',
  statusPreparing:   '#1565C0',
  statusPreparingBg: 'rgba(21,101,192,0.12)',
  statusReady:       '#2E7D32',
  statusReadyBg:     'rgba(46,125,50,0.12)',
  statusCompleted:   '#616161',
  statusCompletedBg: 'rgba(97,97,97,0.12)',
  statusCancelled:   '#B71C1C',
  statusCancelledBg: 'rgba(183,28,28,0.12)',

  white:         '#FFFFFF',
  black:         '#000000',
  transparent:   'transparent',
};

// ── Spacing ──────────────────────────────────────────────────────────────────
export const Spacing = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  24,
  xxxl: 32,
};

// ── Typography ────────────────────────────────────────────────────────────────
export const FontSize = {
  xs:    10,
  sm:    12,
  md:    14,
  lg:    16,
  xl:    18,
  xxl:   22,
  xxxl:  28,
  title: 34,
  hero:  42,
};

// ── Border Radius ─────────────────────────────────────────────────────────────
export const BorderRadius = {
  xs:    4,
  sm:    8,
  md:    12,
  lg:    16,
  xl:    22,
  xxl:   28,
  xxxl:  36,
  round: 999,
};

// ── Shadows (warm-toned for light background) ─────────────────────────────────
export const Shadows = {
  sm: {
    shadowColor: '#8B3A1A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 4,
    elevation: 3,
  },
  md: {
    shadowColor: '#8B3A1A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.13,
    shadowRadius: 8,
    elevation: 6,
  },
  lg: {
    shadowColor: '#8B3A1A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 12,
  },
  primary: {
    shadowColor: '#E8380D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  success: {
    shadowColor: '#2E7D32',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 8,
  },
};
