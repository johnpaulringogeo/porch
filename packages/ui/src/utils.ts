import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combine Tailwind class strings, deduping conflicting utilities.
 * Standard `cn` helper across the UI.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
