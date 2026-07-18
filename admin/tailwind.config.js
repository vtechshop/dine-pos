import { brand } from '../../packages/shared/tokens/brand.ts';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/shared/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: { brand },
    },
  },
  plugins: [],
};
