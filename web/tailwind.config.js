/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/shared/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // CSS-variable-based palette — enables opacity modifiers (bg-brand/20, text-ink/40, etc.)
        // Variables are defined in src/index.css as space-separated RGB channels
        brand:  'rgb(var(--brand) / <alpha-value>)',   // #E8380D — primary CTA / accent
        ink:    'rgb(var(--ink)   / <alpha-value>)',   // #1C0800 — shell bg + primary text
        canvas: 'rgb(var(--canvas)/ <alpha-value>)',   // #FDFAF7 — lightest surface
        mist:   'rgb(var(--mist)  / <alpha-value>)',   // #FFF6EE — main content background
        border: 'rgb(var(--border)/ <alpha-value>)',   // #E8D5C0 — dividers and input borders
      },
    },
  },
  plugins: [],
};
