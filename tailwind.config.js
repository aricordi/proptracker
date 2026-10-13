/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Prime Capitol "Black & Gold" (owner's pick, Oct 13): iPhone dark-mode
        // greys with one muted gold that means "you can tap this".
        'pt-bg':      '#000000',
        'pt-surface': '#1C1C1E',
        'pt-border':  '#2C2C2E',
        'pt-muted':   '#8E8E93',
        'pt-text':    '#F5F5F7',
        'pt-accent':  '#C9A961',
      },
      fontFamily: {
        // The iPhone's own font everywhere (SF Pro); good system fallbacks elsewhere.
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Helvetica Neue"', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"Helvetica Neue"', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
