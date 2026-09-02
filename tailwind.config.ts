import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontSize: {
        // Minimum 18px body text per spec (§4.4)
        base: ['18px', { lineHeight: '1.6' }],
      },
      minHeight: {
        touch: '44px', // 44px minimum touch target per spec (§4.4)
      },
    },
  },
  plugins: [],
};

export default config;
