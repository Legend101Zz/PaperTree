import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // v0.2 feature folders (#175): without this every utility class written there is purged.
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // The same attribute the token blocks read (`@papertree/ui/styles.css`), set before paint by the
  // no-flash script in app/layout.tsx, so `dark:` and the tokens never disagree (#175).
  darkMode: ['selector', '[data-pt-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        sepia: {
          50: '#fdf8f3',
          100: '#f8f1e7',
          200: '#f0e4d0',
          300: '#e5d3b3',
          400: '#d6bc90',
          500: '#c9a66e',
          600: '#b8905a',
          700: '#9a754c',
          800: '#7d5f42',
          900: '#664e38',
        },
      },
    },
  },
  plugins: [],
};

export default config;
