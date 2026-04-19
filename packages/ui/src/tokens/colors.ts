/**
 * Neutral color ramp. Mode-specific accents live in `modes.ts`.
 *
 * Values are HSL so theme variants (dark mode, high-contrast) can tweak
 * lightness independently.
 */
export const neutralLight = {
  bg: 'hsl(30 20% 98%)', // paper-white with the slightest warm cast
  surface: 'hsl(30 15% 96%)',
  border: 'hsl(30 10% 88%)',
  muted: 'hsl(30 8% 60%)',
  text: 'hsl(30 15% 12%)',
  textMuted: 'hsl(30 10% 36%)',
  focus: 'hsl(210 80% 45%)',
};

export const neutralDark = {
  bg: 'hsl(220 20% 8%)',
  surface: 'hsl(220 18% 12%)',
  border: 'hsl(220 14% 22%)',
  muted: 'hsl(220 10% 50%)',
  text: 'hsl(30 10% 94%)',
  textMuted: 'hsl(30 8% 72%)',
  focus: 'hsl(210 80% 60%)',
};
