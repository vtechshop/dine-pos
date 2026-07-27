/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../packages/shared/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          accent: '#E8380D',
          dark:   '#1C0800',
          cream:  '#FFF6EE',
          border: '#E8D5C0',
        },
      },
    },
  },
  plugins: [],
};
