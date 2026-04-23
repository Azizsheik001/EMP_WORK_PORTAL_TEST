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
        // Brand green #86bb46 (AGS)
        brand: {
          DEFAULT: '#86bb46',
          hover: '#6fa338',
          light: '#a5d168',
        },
        // Light default + dark (Pulse/AGS)
        'pulse': {
          'bg': '#f8fafc',
          'sidebar': '#ffffff',
          'card': '#ffffff',
          'accent': '#86bb46',
          'accent-hover': '#6fa338',
          'muted': '#64748b',
          'border': '#e2e8f0',
          'dark-bg': '#0f172a',
          'dark-sidebar': '#0c1222',
          'dark-card': '#1e293b',
          'dark-muted': '#64748b',
          'dark-border': '#334155',
        }
      }
    },
  },
  plugins: [],
}
