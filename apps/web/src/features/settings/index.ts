/**
 * The settings feature: per-browser reading settings (today, the colour scheme). Its public surface.
 */
export { ThemeSwitch, type ThemeSwitchProps } from './components/ThemeSwitch';
export { useTheme, type ThemeState } from './hooks/useTheme';
export {
  NO_FLASH_SCRIPT,
  parseThemeChoice,
  resolveTheme,
  THEME_ATTRIBUTE,
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeChoice,
} from './model/theme';
export { PageSwitch, type PageSwitchProps } from './components/PageSwitch';
export { usePage, useResolvedPage, type PageState } from './hooks/usePage';
export {
  PAGE_ATTRIBUTE,
  PAGE_CHOICES,
  PAGE_NO_FLASH_SNIPPET,
  PAGE_STORAGE_KEY,
  parsePageChoice,
  resolvePage,
  type PageChoice,
  type ResolvedPage,
} from './model/page';
