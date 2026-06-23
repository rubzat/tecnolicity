/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Compras MX institutional deep wine
        institucional: {
          DEFAULT: '#611232',
          50: '#fbf1f4',
          100: '#f6dde5',
          200: '#edb8c8',
          300: '#e08aa5',
          400: '#cd5a78',
          500: '#a93853',
          600: '#872240',
          700: '#611232',
          800: '#4d0e28',
          900: '#3a0b1f',
        },
        neutral: {
          DEFAULT: '#4b5563',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
