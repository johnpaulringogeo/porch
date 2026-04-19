/**
 * Type scale. Mode-specific overrides live in `modes.ts`.
 *
 * Font choices:
 * - Sans: Inter (variable). Fallback: system UI sans.
 * - Serif: Source Serif 4 (variable). Used in Public mode longform.
 * - Mono: JetBrains Mono. Used for DIDs, usernames-as-handles, code.
 */
export const fontFamily = {
  sans: `'Inter Variable', ui-sans-serif, system-ui, -apple-system, sans-serif`,
  serif: `'Source Serif 4 Variable', ui-serif, Georgia, serif`,
  mono: `'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace`,
};

export const fontSize = {
  xs: '0.75rem',
  sm: '0.875rem',
  base: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '1.875rem',
  '4xl': '2.25rem',
};

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};
