/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./*.jsx"
  ],
  theme: {
    extend: {
      colors: {
        midnight: {
          950: '#020617',
          900: '#0f172a',
          800: '#1e293b',
        },
      },
      fontFamily: {
        serif: ['Playfair Display', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out forwards',
        'fade-in-up': 'fadeInUp 0.7s ease-out forwards',
        'pulse-glow': 'pulseGlow 3s ease-in-out infinite',
        'float': 'float 4s ease-in-out infinite',
        'gradient': 'gradientShift 8s ease infinite',
        'aurora': 'aurora 15s ease-in-out infinite',
        'border-glow': 'borderGlow 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        gradientShift: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        aurora: {
          '0%': { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: '0.3' },
          '50%': { transform: 'translate(-30%, -40%) rotate(180deg)', opacity: '0.6' },
          '100%': { transform: 'translate(-50%, -50%) rotate(360deg)', opacity: '0.3' },
        },
        borderGlow: {
          '0%, 100%': { borderColor: 'rgba(251, 191, 36, 0.2)' },
          '50%': { borderColor: 'rgba(251, 191, 36, 0.5)' },
        },
      },
    },
  },
  plugins: [],
}
