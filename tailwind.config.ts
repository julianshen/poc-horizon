import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{html,js,jsx,ts,tsx}', '.electron/**/*.html'],
  theme: {
    extend: {
      colors: {
        chrome: {
          bg: 'var(--chrome-bg)',
          fg: 'var(--chrome-fg)',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
