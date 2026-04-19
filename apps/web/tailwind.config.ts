import type { Config } from 'tailwindcss';
import { porchPreset } from '@porch/ui/tailwind-preset';

const config: Config = {
  presets: [porchPreset as Config],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    // Pull class names out of the shared UI package so Tailwind doesn't
    // purge anything we import from there.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
