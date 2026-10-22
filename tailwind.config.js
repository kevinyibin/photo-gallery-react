/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 主题令牌全部指向 CSS 变量（:root / [data-theme="dark"] 两套），
        // Tailwind 工具类与原版主题切换机制无缝衔接。
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        panel2: 'var(--panel-2)',
        fg: 'var(--text)',
        muted: 'var(--muted)',
        line: 'var(--border)',
        line2: 'var(--border-2)',
        accent: 'var(--accent)',
        soft: 'var(--accent-soft)',
        tile: 'var(--tile)',
        hov: 'var(--hover)',
        // 固定色（不随主题变化）
        like: '#ff5b74',
        danger: '#e5534b',
        star: '#ffc23d',
        star2: '#f5a623'
      },
      borderRadius: {
        app: 'var(--radius)'
      },
      boxShadow: {
        card: 'var(--shadow)',
        pop: 'var(--shadow-lg)',
        tileh: '0 2px 6px rgba(16,24,40,.10), 0 14px 34px rgba(16,24,40,.16)',
        likeglow: '0 0 0 3px rgba(255,91,116,.22), 0 8px 24px rgba(255,91,116,.18)',
        batch: '0 -6px 24px rgba(16, 24, 40, .12)',
        sidedrawer: '24px 0 60px rgba(0,0,0,.25)',
        metadrawer: '0 -20px 60px rgba(0,0,0,.5)'
      },
      keyframes: {
        shimmer: {
          from: { backgroundPosition: '150% 0' },
          to: { backgroundPosition: '-150% 0' }
        },
        lbfade: {
          from: { opacity: '0' },
          to: { opacity: '1' }
        }
      },
      animation: {
        shimmer: 'shimmer 1.3s infinite linear',
        lbfade: 'lbfade .2s ease-out'
      }
    }
  },
  plugins: []
};
