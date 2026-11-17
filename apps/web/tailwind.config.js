/** @type {import('tailwindcss').Config} */
// Every value here points at a token in src/styles/tokens.css. Scales are deliberately restricted:
// type 10/11 (labels, meta), 12/13 (body), 14/16 (section), 24 (page title); weights 400/500 (600 for the
// page title at most); radii 8 / 10 / 14 / 999.
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    fontFamily: {
      sans: ['var(--font-sans)'],
      mono: ['var(--font-mono)'],
    },
    fontSize: {
      '2xs': ['11px', { lineHeight: '16px', letterSpacing: '0.06em' }],
      xs: ['11px', { lineHeight: '16px' }],
      sm: ['12px', { lineHeight: '18px' }],
      base: ['13px', { lineHeight: '20px' }],
      md: ['14px', { lineHeight: '20px' }],
      lg: ['16px', { lineHeight: '24px', letterSpacing: '-0.01em' }],
      xl: ['24px', { lineHeight: '32px', letterSpacing: '-0.015em' }],
    },
    fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '600' },
    borderRadius: {
      none: '0',
      sm: 'var(--r-sm)',
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
        tint: { DEFAULT: 'var(--tint)', ink: 'var(--tint-ink)', soft: 'var(--tint-soft)' },
        ok: rgb('--ok-rgb'),
        warn: rgb('--warn-rgb'),
        bad: rgb('--bad-rgb'),
        unknown: rgb('--unknown-rgb'),
        canvas: 'var(--canvas)',
        panel: { DEFAULT: 'var(--panel)', sunk: 'var(--panel-sunk)' },
        stage: { DEFAULT: 'var(--stage)', ink: 'var(--stage-ink)', 'ink-2': 'var(--stage-ink-2)', line: 'var(--stage-line)', pill: 'var(--stage-pill)' },
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
        panel: 'var(--shadow-panel)',
        base: 'var(--shadow-panel)',
        raised: 'var(--shadow-pop)',
        overlay: 'var(--shadow-pop)',
        pop: 'var(--shadow-pop)',
        lift: 'var(--shadow-lift)',
      },
      transitionTimingFunction: { DEFAULT: 'var(--ease-out)', out: 'var(--ease-out)' },
      transitionDuration: { DEFAULT: '140ms', fast: '140ms', base: '200ms', panel: '240ms' },
      zIndex: { toolbar: 'var(--z-toolbar)', 'overlay-ui': 'var(--z-overlay-ui)', drawer: 'var(--z-drawer)', popover: 'var(--z-popover)', dialog: 'var(--z-dialog)', toast: 'var(--z-toast)' },
    },
  },
  plugins: [],
};
