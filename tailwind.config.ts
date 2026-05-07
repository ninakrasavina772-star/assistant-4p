import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: { bg: "#0b1f3a", accent: "#0d4f9c" }
      }
    }
  },
  plugins: []
} satisfies Config;
