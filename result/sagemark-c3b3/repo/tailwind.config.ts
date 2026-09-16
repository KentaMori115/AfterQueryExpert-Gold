import type { Config } from 'tailwindcss'
import defaultTheme from 'tailwindcss/defaultTheme'

export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        parchment: {
          50: '#fbf7ee',
          100: '#f4ecd5',
          200: '#e8d6a8',
          300: '#d9bb74',
          400: '#c79f4d',
          500: '#a98239',
          600: '#86662c',
          700: '#624a22',
          800: '#3f2f17',
          900: '#21180c',
        },
        ember: {
          50: '#fff4ec',
          100: '#ffe4cc',
          200: '#fdc28d',
          300: '#fb9b51',
          400: '#f6772a',
          500: '#e1581a',
          600: '#bb4313',
          700: '#8c3210',
          800: '#5a200b',
          900: '#321106',
        },
        ink: {
          50: '#f5f5f4',
          100: '#e7e6e3',
          200: '#cfcdc6',
          300: '#a8a59a',
          400: '#7c786b',
          500: '#534f44',
          600: '#3a362e',
          700: '#27241f',
          800: '#181612',
          900: '#0c0a08',
        },
        moss: {
          400: '#86a16a',
          500: '#62844a',
          600: '#456733',
        },
        crimson: {
          400: '#d4525a',
          500: '#b73a44',
          600: '#8e2730',
        },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', ...defaultTheme.fontFamily.serif],
        body: ['Inter', ...defaultTheme.fontFamily.sans],
      },
      boxShadow: {
        card: '0 1px 2px rgba(33, 24, 12, 0.06), 0 2px 8px rgba(33, 24, 12, 0.05)',
        floating: '0 4px 18px rgba(33, 24, 12, 0.12)',
      },
      borderRadius: {
        soft: '0.625rem',
      },
    },
  },
  plugins: [],
} satisfies Config
