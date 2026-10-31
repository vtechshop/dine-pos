/** @type {import('tailwindcss').Config} */

// Theme: burgundy + coral + soft pink on warm cream. All colours come from the CSS
// variables in src/index.css (space-separated RGB, so opacity modifiers work).
const v = name => `rgb(var(--${name}) / <alpha-value>)`;

// Tailwind's stock green / red / amber / orange scales are used across the app for
// status colours. Re-derive them from the theme's success / danger / warning / coral so
// every status colour belongs to the palette, without touching each screen.
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a); const [r2, g2, b2] = hexToRgb(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}
/** A 50–900 scale whose `baseStep` is exactly `base`. */
function scale(base, baseStep) {
  const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const i0 = steps.indexOf(baseStep);
  // Lighter steps: fixed share of white per step, so pale tints (50/100) look alike
  const lighten = { 50: 0.92, 100: 0.84, 200: 0.68, 300: 0.5, 400: 0.3, 500: 0.14 };
  const darken  = [0.16, 0.32, 0.46, 0.58, 0.68];       // darker steps, by distance
  const out = {};
  steps.forEach((s, i) => {
    if (i === i0) out[s] = base;
    else if (i < i0) out[s] = mix(base, '#ffffff', lighten[s]);
    else out[s] = mix(base, '#1a0f12', darken[i - i0 - 1] ?? 0.75);
  });
  return out;
}

const success = scale('#43866A', 600);
const danger  = scale('#C84C54', 600);
const warning = scale('#D49A43', 500);
const coral   = scale('#F16B65', 500);
const warmGray = scale('#806D70', 500);  // greys lean warm to sit on cream
const mauve   = scale('#7D5A7A', 600);   // "info" (was blue) — distinct from danger red
const wine    = scale('#8E354B', 600);   // purple / violet accents
const blush   = scale('#FFAAA5', 300);   // pink accents

export default {
  // The app is light-only. Without this, Tailwind's default ('media') applies
  // dark: variants whenever the OS is in dark mode, mixing dark-mode colours
  // into light pages.
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/shared/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand:    v('brand'),     // #F16B65 coral — primary buttons, active / selected fills
        ink:      v('ink'),       // #33252A — primary text
        canvas:   v('canvas'),    // #FFFCF7 ivory — cards, header, inputs
        mist:     v('mist'),      // #F5EBDD warm cream — page background
        border:   v('border'),    // #E8D9CC — dividers and input borders
        burgundy: v('burgundy'),  // #641E32 — sidebar, secondary buttons
        wine:     v('wine'),      // #8E354B — secondary burgundy
        blush:    v('blush'),     // #FFAAA5 soft pink
        petal:    v('petal'),     // #FCE4E1 light pink
        muted:    v('muted'),     // #806D70 — secondary text
        success:  v('success'),   // #43866A
        warning:  v('warning'),   // #D49A43
        danger:   v('danger'),    // #C84C54
        // Status scales derived from the theme (see note above)
        green: success, emerald: success, teal: success,
        red: danger, rose: danger,
        amber: warning, yellow: warning,
        orange: coral,
        gray: warmGray, slate: warmGray, neutral: warmGray, zinc: warmGray, stone: warmGray,
        blue: mauve, sky: mauve, indigo: mauve,
        purple: wine, violet: wine,
        pink: blush,
      },
      // Accent text uses the deeper rose: coral text is too faint on cream.
      textColor: { brand: v('brand-ink') },
      // Dark surfaces (bg-ink buttons, bg-ink/5 header tints) are burgundy, not text-dark.
      backgroundColor: { ink: v('burgundy') },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(100 30 50 / 0.06), 0 1px 3px 0 rgb(100 30 50 / 0.05)',
        DEFAULT: '0 2px 6px -1px rgb(100 30 50 / 0.08), 0 1px 3px -1px rgb(100 30 50 / 0.06)',
        md: '0 6px 14px -4px rgb(100 30 50 / 0.12)',
        lg: '0 12px 24px -8px rgb(100 30 50 / 0.16)',
      },
    },
  },
  plugins: [],
};
