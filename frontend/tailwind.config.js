/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f1f7ff',
          100: '#e2efff',
          200: '#c5ddff',
          300: '#94c2ff',
          400: '#579df8',
          500: '#0c66e4',
          600: '#0e57b7',
          700: '#174a8b',
          800: '#172b4d',
          900: '#0f213d',
          950: '#09182d',
        },
        app: {
          canvas: '#e8eef6',
          panel: '#f7f9fc',
          'panel-strong': '#ffffff',
          'panel-muted': '#eef3f8',
          line: '#cbd6e4',
          ink: '#172b4d',
          muted: '#53657d',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(23, 43, 77, 0.05), 0 10px 28px rgba(23, 43, 77, 0.08)',
        float: '0 20px 60px rgba(23, 43, 77, 0.18)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Cantarell',
          '"Fira Sans"',
          '"Droid Sans"',
          '"Helvetica Neue"',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
}
