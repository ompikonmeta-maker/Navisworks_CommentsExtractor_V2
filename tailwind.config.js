/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      // Map Material Design 3 system color roles to Tailwind color utilities.
      // The actual values live as CSS custom properties in src/index.css so
      // light/dark switch without a rebuild.
      colors: {
        primary: 'var(--md-sys-color-primary)',
        'on-primary': 'var(--md-sys-color-on-primary)',
        'primary-container': 'var(--md-sys-color-primary-container)',
        'on-primary-container': 'var(--md-sys-color-on-primary-container)',
        secondary: 'var(--md-sys-color-secondary)',
        'on-secondary': 'var(--md-sys-color-on-secondary)',
        'secondary-container': 'var(--md-sys-color-secondary-container)',
        'on-secondary-container': 'var(--md-sys-color-on-secondary-container)',
        tertiary: 'var(--md-sys-color-tertiary)',
        'on-tertiary': 'var(--md-sys-color-on-tertiary)',
        'tertiary-container': 'var(--md-sys-color-tertiary-container)',
        'on-tertiary-container': 'var(--md-sys-color-on-tertiary-container)',
        error: 'var(--md-sys-color-error)',
        'on-error': 'var(--md-sys-color-on-error)',
        'error-container': 'var(--md-sys-color-error-container)',
        'on-error-container': 'var(--md-sys-color-on-error-container)',
        background: 'var(--md-sys-color-background)',
        'on-background': 'var(--md-sys-color-on-background)',
        surface: 'var(--md-sys-color-surface)',
        'on-surface': 'var(--md-sys-color-on-surface)',
        'surface-variant': 'var(--md-sys-color-surface-variant)',
        'on-surface-variant': 'var(--md-sys-color-on-surface-variant)',
        'surface-dim': 'var(--md-sys-color-surface-dim)',
        'surface-bright': 'var(--md-sys-color-surface-bright)',
        'surface-lowest': 'var(--md-sys-color-surface-container-lowest)',
        'surface-low': 'var(--md-sys-color-surface-container-low)',
        'surface-container': 'var(--md-sys-color-surface-container)',
        'surface-high': 'var(--md-sys-color-surface-container-high)',
        'surface-highest': 'var(--md-sys-color-surface-container-highest)',
        outline: 'var(--md-sys-color-outline)',
        'outline-variant': 'var(--md-sys-color-outline-variant)',
        // Semantic status accents (fixed, not part of the seed scheme)
        'status-open': 'var(--tabelin-status-open)',
        'status-review': 'var(--tabelin-status-review)',
        'status-closed': 'var(--tabelin-status-closed)',
      },
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '28px',
      },
      fontFamily: {
        sans: ['Roboto Flex', 'Roboto', 'system-ui', 'sans-serif'],
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
