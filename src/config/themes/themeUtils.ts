/**
 * Theme Utilities
 * Helper functions for theme management
 */

import { ThemeName, ThemeConfig } from '@/types/theme.types';

export const DEFAULT_THEME: ThemeName = 'dark';
// Only Light and Dark themes exposed in UI - other themes hidden for now
export const AVAILABLE_THEMES: ThemeName[] = ['light', 'dark'];
// Hidden themes (available in code but not in UI selector):
// 'vf', 'fibreflow', 'velocity'

/**
 * Get theme configuration by name
 * @param name Theme name
 * @param themes Theme registry
 * @returns Theme configuration
 */
export function getTheme(name: ThemeName, themes: Record<ThemeName, ThemeConfig>): ThemeConfig {
  return themes[name] || themes[DEFAULT_THEME];
}

/**
 * Check if theme name is valid
 * @param name Theme name to validate
 * @returns True if valid theme name
 */
export function isValidTheme(name: string): name is ThemeName {
  return AVAILABLE_THEMES.includes(name as ThemeName);
}

/**
 * Get theme display name
 * @param name Theme name
 * @param themes Theme registry
 * @returns Display name for theme
 */
export function getThemeDisplayName(name: ThemeName, themes: Record<ThemeName, ThemeConfig>): string {
  return getTheme(name, themes).displayName;
}

/**
 * Get available theme options for selectors
 * @param themes Theme registry
 * @returns Array of theme options
 */
export function getThemeOptions(themes: Record<ThemeName, ThemeConfig>) {
  return AVAILABLE_THEMES.map(name => ({
    value: name,
    label: themes[name].displayName,
    description: themes[name].description,
    isDark: themes[name].isDark,
  }));
}

/**
 * Filter themes by dark/light mode
 * @param themes Theme registry
 * @param isDark Filter for dark themes
 * @returns Filtered theme names
 */
export function getThemesByMode(themes: Record<ThemeName, ThemeConfig>, isDark: boolean): ThemeName[] {
  return AVAILABLE_THEMES.filter(name => themes[name].isDark === isDark);
}

/**
 * Get theme description (simple version without theme registry)
 * @param theme Theme name
 * @returns Theme description
 */
export function getThemeDescription(theme: ThemeName): string {
  const descriptions: Record<ThemeName, string> = {
    light: 'Clean and bright interface',
    dark: 'Easy on the eyes in low light',
    vf: 'Velo Flow brand theme',
    fibreflow: 'FibreFlow brand theme',
    velocity: 'Premium high-tech theme with glassmorphism and neon effects',
  };
  return descriptions[theme] || '';
}