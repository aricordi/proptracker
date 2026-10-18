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
        // Raised layer (sheets, pressed rows): one step lighter than a card.
        'pt-raised':  '#2C2C2E',
      },
      // Premium layer (Oct 18): no hard outlines. Cards are framed by a faint inner hairline
      // (catches the light like glass), floating things get soft layered shadows.
      boxShadow: {
        hairline: 'inset 0 0 0 0.5px rgba(255,255,255,0.08)',
        card:     'inset 0 0.5px 0 rgba(255,255,255,0.07), 0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)',
        float:    '0 -0.5px 0 rgba(255,255,255,0.08), 0 -12px 40px -8px rgba(0,0,0,0.7)',
        gold:     'inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.12), 0 6px 20px -6px rgba(201,169,97,0.45)',
        violet:   'inset 0 1px 0 rgba(255,255,255,0.3), 0 6px 20px -6px rgba(191,157,255,0.45)',
      },
      // Apple-like "spring" curve for every press, open and slide.
      transitionTimingFunction: { spring: 'cubic-bezier(0.32, 0.72, 0, 1)' },
      transitionDuration: { 250: '250ms' },
      letterSpacing: { title: '-0.026em', heading: '-0.017em' },
      fontFamily: {
        // The iPhone's own font everywhere (SF Pro); good system fallbacks elsewhere.
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Helvetica Neue"', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"Helvetica Neue"', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
