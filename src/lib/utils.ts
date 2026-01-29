import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Convert snake_case or kebab-case string to Title Case.
 * e.g. "field_operations" → "Field Operations"
 */
export function formatLabel(value: string | null | undefined, fallback = '-'): string {
  if (!value) return fallback;
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
