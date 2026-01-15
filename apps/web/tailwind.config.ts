import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        sepia: {
          50: "#fdf8f3",
          100: "#f8f1e7",
          200: "#f0e4d0",
          300: "#e5d3b3",
          400: "#d6bc90",
          500: "#c9a66e",
          600: "#b8905a",
          700: "#9a754c",
          800: "#7d5f42",
          900: "#664e38",
        },
      },
    },
  },
  plugins: [],
};

export default config;
