/**
 * App themes. The theme is one attribute on <html> (`data-theme`); each theme's
 * stylesheet scopes itself under it. "stardust" is the base stylesheets as they
 * are (the game look), so it needs no overrides.
 */
export const THEMES = [
  { id: 'refined', label: 'Refined', blurb: 'Clean, light type and spacing. The default.' },
  { id: 'stardust', label: 'Stardust', blurb: 'The original game-styled look.' },
] as const
export type ThemeId = (typeof THEMES)[number]['id']
export const DEFAULT_THEME: ThemeId = 'refined'
const KEY = 'cafe.theme'

export function readTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY)
    return THEMES.some((t) => t.id === v) ? (v as ThemeId) : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* private mode: the choice just does not persist */
  }
}
