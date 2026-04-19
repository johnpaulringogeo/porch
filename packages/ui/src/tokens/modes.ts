/**
 * Mode-specific design tokens. Each mode has a distinct accent + treatment so
 * that the user can never confuse which mode they're in (per design-principles
 * §"Mode visual distinction").
 *
 * v0 only ships Home, but the table is defined so that as other modes land we
 * already know the visual language we're committing to.
 */
export type Mode = 'home' | 'public' | 'community' | 'professional' | 'creators';

export interface ModeTheme {
  /** Display label shown in mode badges. */
  label: string;
  /** Primary accent color (HSL). */
  accent: string;
  /** Background tint for the mode's surfaces. */
  surfaceTint: string;
  /** Body type family — sans for app-y modes, serif for Public longform. */
  bodyFamily: 'sans' | 'serif';
  /** Density: 'comfortable' for Home/Community/Professional, 'spacious' for Public, 'compact' for Creators dashboards. */
  density: 'compact' | 'comfortable' | 'spacious';
}

export const modeThemes: Record<Mode, ModeTheme> = {
  home: {
    label: 'Home',
    accent: 'hsl(160 50% 36%)', // forest green — quiet, intimate
    surfaceTint: 'hsl(160 30% 97%)',
    bodyFamily: 'sans',
    density: 'comfortable',
  },
  public: {
    label: 'Public',
    accent: 'hsl(28 70% 42%)', // ink-on-paper amber
    surfaceTint: 'hsl(40 40% 97%)',
    bodyFamily: 'serif',
    density: 'spacious',
  },
  community: {
    label: 'Community',
    accent: 'hsl(220 60% 42%)', // common-room blue
    surfaceTint: 'hsl(220 30% 97%)',
    bodyFamily: 'sans',
    density: 'comfortable',
  },
  professional: {
    label: 'Professional',
    accent: 'hsl(200 30% 30%)', // muted slate
    surfaceTint: 'hsl(200 15% 97%)',
    bodyFamily: 'sans',
    density: 'comfortable',
  },
  creators: {
    label: 'Creators',
    accent: 'hsl(340 60% 48%)', // backstage red
    surfaceTint: 'hsl(340 25% 97%)',
    bodyFamily: 'sans',
    density: 'compact',
  },
};
