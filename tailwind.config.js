/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      // Map Material Design 3 system color roles to Tailwind color utilities.
      // Wrapped in color-mix so opacity modifiers (border-outline-variant/50)
      // work with the CSS-variable colours.
      // The actual values live as CSS custom properties in src/index.css so
      // light/dark switch without a rebuild.
      colors: {
        primary: 'color-mix(in srgb, var(--md-sys-color-primary) calc(<alpha-value> * 100%), transparent)',
        'on-primary': 'color-mix(in srgb, var(--md-sys-color-on-primary) calc(<alpha-value> * 100%), transparent)',
        'primary-container': 'color-mix(in srgb, var(--md-sys-color-primary-container) calc(<alpha-value> * 100%), transparent)',
        'on-primary-container': 'color-mix(in srgb, var(--md-sys-color-on-primary-container) calc(<alpha-value> * 100%), transparent)',
        secondary: 'color-mix(in srgb, var(--md-sys-color-secondary) calc(<alpha-value> * 100%), transparent)',
        'on-secondary': 'color-mix(in srgb, var(--md-sys-color-on-secondary) calc(<alpha-value> * 100%), transparent)',
        'secondary-container': 'color-mix(in srgb, var(--md-sys-color-secondary-container) calc(<alpha-value> * 100%), transparent)',
        'on-secondary-container': 'color-mix(in srgb, var(--md-sys-color-on-secondary-container) calc(<alpha-value> * 100%), transparent)',
        tertiary: 'color-mix(in srgb, var(--md-sys-color-tertiary) calc(<alpha-value> * 100%), transparent)',
        'on-tertiary': 'color-mix(in srgb, var(--md-sys-color-on-tertiary) calc(<alpha-value> * 100%), transparent)',
        'tertiary-container': 'color-mix(in srgb, var(--md-sys-color-tertiary-container) calc(<alpha-value> * 100%), transparent)',
        'on-tertiary-container': 'color-mix(in srgb, var(--md-sys-color-on-tertiary-container) calc(<alpha-value> * 100%), transparent)',
        error: 'color-mix(in srgb, var(--md-sys-color-error) calc(<alpha-value> * 100%), transparent)',
        'on-error': 'color-mix(in srgb, var(--md-sys-color-on-error) calc(<alpha-value> * 100%), transparent)',
        'error-container': 'color-mix(in srgb, var(--md-sys-color-error-container) calc(<alpha-value> * 100%), transparent)',
        'on-error-container': 'color-mix(in srgb, var(--md-sys-color-on-error-container) calc(<alpha-value> * 100%), transparent)',
        background: 'color-mix(in srgb, var(--md-sys-color-background) calc(<alpha-value> * 100%), transparent)',
        'on-background': 'color-mix(in srgb, var(--md-sys-color-on-background) calc(<alpha-value> * 100%), transparent)',
        surface: 'color-mix(in srgb, var(--md-sys-color-surface) calc(<alpha-value> * 100%), transparent)',
        'on-surface': 'color-mix(in srgb, var(--md-sys-color-on-surface) calc(<alpha-value> * 100%), transparent)',
        'surface-variant': 'color-mix(in srgb, var(--md-sys-color-surface-variant) calc(<alpha-value> * 100%), transparent)',
        'on-surface-variant': 'color-mix(in srgb, var(--md-sys-color-on-surface-variant) calc(<alpha-value> * 100%), transparent)',
        'surface-dim': 'color-mix(in srgb, var(--md-sys-color-surface-dim) calc(<alpha-value> * 100%), transparent)',
        'surface-bright': 'color-mix(in srgb, var(--md-sys-color-surface-bright) calc(<alpha-value> * 100%), transparent)',
        'surface-lowest': 'color-mix(in srgb, var(--md-sys-color-surface-container-lowest) calc(<alpha-value> * 100%), transparent)',
        'surface-low': 'color-mix(in srgb, var(--md-sys-color-surface-container-low) calc(<alpha-value> * 100%), transparent)',
        'surface-container': 'color-mix(in srgb, var(--md-sys-color-surface-container) calc(<alpha-value> * 100%), transparent)',
        'surface-high': 'color-mix(in srgb, var(--md-sys-color-surface-container-high) calc(<alpha-value> * 100%), transparent)',
        'surface-highest': 'color-mix(in srgb, var(--md-sys-color-surface-container-highest) calc(<alpha-value> * 100%), transparent)',
        outline: 'color-mix(in srgb, var(--md-sys-color-outline) calc(<alpha-value> * 100%), transparent)',
        'outline-variant': 'color-mix(in srgb, var(--md-sys-color-outline-variant) calc(<alpha-value> * 100%), transparent)',
        // Semantic status accents (fixed, not part of the seed scheme)
        'status-open': 'color-mix(in srgb, var(--tabelin-status-open) calc(<alpha-value> * 100%), transparent)',
        'status-review': 'color-mix(in srgb, var(--tabelin-status-review) calc(<alpha-value> * 100%), transparent)',
        'status-closed': 'color-mix(in srgb, var(--tabelin-status-closed) calc(<alpha-value> * 100%), transparent)',
      },
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '28px',
        card: 'var(--tabelin-radius-card)', // 26px
        control: 'var(--tabelin-radius-control)', // 15px
      },
      fontFamily: {
        sans: ['Roboto', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'md-1': '0 1px 2px rgba(0,0,0,.30), 0 1px 3px 1px rgba(0,0,0,.15)',
        'md-2': '0 1px 2px rgba(0,0,0,.30), 0 2px 6px 2px rgba(0,0,0,.15)',
        'md-3': '0 4px 8px 3px rgba(0,0,0,.15), 0 1px 3px rgba(0,0,0,.30)',
      },
    },
  },
  plugins: [],
};
