/** Light and dark appearance. The palette lives in index.css; this picks which one applies. */

export type ThemeChoice = 'dark' | 'light' | 'system'
export type Theme = 'dark' | 'light'

// Matches --color-ink in each palette, for the browser UI (address bar, PWA title bar).
const THEME_COLOR: Record<Theme, string> = { dark: '#120d0c', light: '#faf6f3' }

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
  if (choice === 'system') return prefersDark ? 'dark' : 'light'
  return choice
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
}

/** Put a theme on the page: the data attribute the CSS keys on, and the browser colour. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme
  root.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}

/** Follow the choice now, and the system setting as it changes when the choice is "system". */
export function watchTheme(choice: ThemeChoice): () => void {
  applyTheme(resolveTheme(choice, systemPrefersDark()))
  if (choice !== 'system' || !window.matchMedia) return () => {}
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
