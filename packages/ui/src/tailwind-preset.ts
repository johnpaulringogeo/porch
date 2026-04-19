import type { Config } from 'tailwindcss';
import { fontFamily, fontSize, fontWeight } from './tokens/type.js';
import { radius, spacing } from './tokens/spacing.js';

/**
 * Shared Tailwind preset — each app extends this so tokens stay single-sourced.
 */
export const porchPreset: Partial<Config> = {
  theme: {
    extend: {
      fontFamily: {
        sans: fontFamily.sans.split(/,\s*/),
        serif: fontFamily.serif.split(/,\s*/),
        mono: fontFamily.mono.split(/,\s*/),
      },
      fontSize,
      fontWeight: fontWeight as unknown as Config['theme']['fontWeight'],
      spacing,
      borderRadius: radius,
      colors: {
        // Per-mode accents — utilities like `bg-mode-home` are set per app
        // via CSS variables so layout can swap mode themes without class churn.
        'mode-home': 'var(--mode-home, #2e6d54)',
        'mode-public': 'var(--mode-public, #bb7026)',
        'mode-community': 'var(--mode-community, #2a61b8)',
        'mode-professional': 'var(--mode-professional, #3a5566)',
        'mode-creators': 'var(--mode-creators, #c2356d)',
      },
    },
  },
};
