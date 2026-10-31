/** @type {import('tailwindcss').Config} */

// Theme: espresso brown + warm ivory. All colours come from the CSS
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

const success = scale('#4F8A70', 600);
const danger  = scale('#D85D5D', 500);
const warning = scale('#D5A04C', 500);
const brown   = scale('#A17B5C', 500);   // "orange" / "pink" accents become warm brown (no strong orange)
const warmGray = scale('#91877E', 500);  // greys lean warm to sit on ivory
const slate   = scale('#6F7F8C', 600);   // "info" (was blue) — calm, distinct from brown and red
const lavender = scale('#7A6F8F', 600);  // purple / violet accents, muted

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
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        brand:   v('brand'),    // #805A3B espresso — primary buttons, active / selected
        ink:     v('ink'),      // #35291F — primary text
        canvas:  v('canvas'),   // #FFFFFF — cards, header, inputs
        mist:    v('mist'),     // #F3F0EB — page background
        border:  v('border'),   // #E5DED5 — dividers and input borders
        coffee:  v('coffee'),   // #4A3325 deep coffee — Pay, dark surfaces
        mocha:   v('mocha'),    // #A17B5C secondary brown
        ivory:   v('ivory'),    // #F5F1EA warm ivory — sidebar, soft panels
        beige:   v('beige'),    // #EAE3D9 light beige — hover / neutral buttons
        muted:   v('muted'),    // #91877E — secondary text
        success: v('success'),  // #4F8A70
        warning: v('warning'),  // #D5A04C
        danger:  v('danger'),   // #D85D5D
        // Status scales derived from the theme (see note above)
        green: success, emerald: success, teal: success,
        red: danger, rose: danger,
        amber: warning, yellow: warning,
        orange: brown, pink: brown,
        gray: warmGray, slate: warmGray, neutral: warmGray, zinc: warmGray, stone: warmGray,
        blue: slate, sky: slate, indigo: slate,
        purple: lavender, violet: lavender,
      },
      textColor: { brand: v('brand-ink') },
      // Dark surfaces (bg-ink buttons, bg-ink/5 header tints) are deep coffee.
      backgroundColor: { ink: v('coffee') },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(74 51 37 / 0.05), 0 1px 3px 0 rgb(74 51 37 / 0.04)',
        DEFAULT: '0 2px 6px -1px rgb(74 51 37 / 0.07), 0 1px 3px -1px rgb(74 51 37 / 0.05)',
        md: '0 6px 14px -4px rgb(74 51 37 / 0.10)',
        lg: '0 12px 24px -8px rgb(74 51 37 / 0.14)',
      },
    },
  },
  plugins: [],
};
