/** @type {import('tailwindcss').Config} */
// Every value here points at a token in src/styles/tokens.css. The scales are deliberately restricted:
// type 11 (labels) / 12 / 13 / 14 / 16 / 20 / 28, weights 400-600, radii 10 / 14 / 999.
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    fontFamily: {
      sans: ['var(--font-sans)'],
      mono: ['var(--font-mono)'],
    },
    fontSize: {
      '2xs': ['11px', { lineHeight: '16px', letterSpacing: '0.06em' }],
      xs: ['12px', { lineHeight: '16px' }],
      sm: ['13px', { lineHeight: '20px' }],
      base: ['14px', { lineHeight: '20px' }],
      md: ['16px', { lineHeight: '24px' }],
      lg: ['20px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
      xl: ['28px', { lineHeight: '36px', letterSpacing: '-0.01em' }],
    },
    fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '600' },
    borderRadius: {
      none: '0',
      sm: 'var(--r-control)',
      DEFAULT: 'var(--r-control)',
      md: 'var(--r-control)',
      lg: 'var(--r-control)',
      control: 'var(--r-control)',
      xl: 'var(--r-panel)',
      '2xl': 'var(--r-panel)',
      panel: 'var(--r-panel)',
      full: 'var(--r-chip)',
    },
    extend: {
      colors: {
        ink: { DEFAULT: 'var(--ink-1)', 2: 'var(--ink-2)', 3: 'var(--ink-3)' },
        line: { DEFAULT: 'var(--line)', strong: 'var(--line-strong)' },
        accent: { DEFAULT: rgb('--accent-rgb'), ink: 'var(--accent-ink)' },
        ok: rgb('--ok-rgb'),
        warn: rgb('--warn-rgb'),
        bad: rgb('--bad-rgb'),
        unknown: rgb('--unknown-rgb'),
        surface: {
          hover: 'var(--hover)',
          press: 'var(--press)',
          track: 'var(--track)',
          solid: 'var(--surface-solid)',
          inset: 'var(--surface-inset)',
          raised: 'var(--surface-raised)',
          field: 'var(--field)',
        },
      },
      letterSpacing: { tight: '-0.01em', label: '0.06em' },
      boxShadow: {
        base: 'var(--glass-highlight), var(--shadow-base)',
        raised: 'var(--glass-highlight), var(--shadow-raised)',
        overlay: 'var(--glass-highlight), var(--shadow-overlay)',
        lift: 'var(--glass-highlight), var(--shadow-lift)',
      },
      transitionTimingFunction: { DEFAULT: 'var(--ease-out)', out: 'var(--ease-out)' },
      transitionDuration: { DEFAULT: '140ms', fast: '140ms', base: '200ms', panel: '240ms' },
      zIndex: { toolbar: 'var(--z-toolbar)', 'overlay-ui': 'var(--z-overlay-ui)', drawer: 'var(--z-drawer)', popover: 'var(--z-popover)', dialog: 'var(--z-dialog)', toast: 'var(--z-toast)' },
    },
  },
  plugins: [],
};
