/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'pt-bg':      '#1C1917',
        'pt-surface': '#292524',
        'pt-border':  '#44403C',
        'pt-muted':   '#78716C',
        'pt-text':    '#E7E5E4',
        'pt-accent':  '#F59E0B',
      },
      fontFamily: {
        display: ['"Passion One"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
