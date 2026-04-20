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
      fontWeight: fontWeight as unknown as NonNullable<Config['theme']>['fontWeight'],
      spacing,
      borderRadius: radius,
      colors: {
        // Per-mode accents + surfaces. The CSS vars live in the app's
        // globals.css so layout can swap mode themes via `data-mode` without
        // class churn. The `<alpha-value>` token keeps opacity modifiers
        // working (e.g. `bg-mode-home/50`, `text-mode-public/80`).
        'mode-home': 'hsl(var(--mode-home-accent) / <alpha-value>)',
        'mode-home-surface': 'hsl(var(--mode-home-surface) / <alpha-value>)',
        'mode-public': 'hsl(var(--mode-public-accent) / <alpha-value>)',
        'mode-public-surface': 'hsl(var(--mode-public-surface) / <alpha-value>)',
        'mode-community': 'hsl(var(--mode-community-accent) / <alpha-value>)',
        'mode-community-surface': 'hsl(var(--mode-community-surface) / <alpha-value>)',
        'mode-professional': 'hsl(var(--mode-professional-accent) / <alpha-value>)',
        'mode-professional-surface': 'hsl(var(--mode-professional-surface) / <alpha-value>)',
        'mode-creators': 'hsl(var(--mode-creators-accent) / <alpha-value>)',
        'mode-creators-surface': 'hsl(var(--mode-creators-surface) / <alpha-value>)',
      },
    },
  },
};
