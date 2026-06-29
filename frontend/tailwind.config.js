/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        card: 'var(--card)',
        ring: 'var(--ring)',
        input: 'var(--input)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        border: 'var(--border)',
        popover: 'var(--popover)',
        primary: 'var(--primary)',
        secondary: 'var(--secondary)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        destructive: 'var(--destructive)',
        surface: {
          DEFAULT: 'var(--background)',
          card:    'var(--card)',
          elevated:'var(--muted)',
          input:   'var(--input)',
        },
        violet: {
          350: '#b085f5',
          450: '#9556f0',
        },
      },
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
        serif: ['Libre Baskerville', 'serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      backdropBlur: {
        '4xl': '64px',
        '5xl': '80px',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        glass:         '0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
        'glass-lg':    '0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)',
        'glass-hover': '0 16px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12)',
        'glow-violet': '0 0 32px rgba(139,92,246,0.35)',
        'glow-cyan':   '0 0 24px rgba(6,182,212,0.25)',
        'glow-green':  '0 0 16px rgba(52,211,153,0.3)',
      },
      animation: {
        'pulse-slow':  'pulse 2.4s ease-in-out infinite',
        'pulse-fast':  'pulse 1.2s ease-in-out infinite',
        'float':       'float 5s ease-in-out infinite',
        'slide-up':    'slideUp 0.35s cubic-bezier(0.16,1,0.3,1)',
        'fade-in':     'fadeIn 0.25s ease',
        'spin-once':   'spin 0.5s ease',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':       { transform: 'translateY(-8px)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
