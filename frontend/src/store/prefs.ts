import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { NO_FILTERS, type DiscoverFilters } from '@/lib/filters'
import type { ThemeChoice } from '@/lib/theme'

interface PrefsState {
  /** Show system notifications while Kindred is in a background tab. */
  desktopNotifications: boolean
  setDesktopNotifications: (on: boolean) => void
  /** Narrowing applied to the Discover deck; remembered on this device. */
  discoverFilters: DiscoverFilters
  setDiscoverFilters: (filters: DiscoverFilters) => void
  theme: ThemeChoice
  setTheme: (theme: ThemeChoice) => void
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      desktopNotifications: false,
      setDesktopNotifications: (desktopNotifications) => set({ desktopNotifications }),
      discoverFilters: NO_FILTERS,
      setDiscoverFilters: (discoverFilters) => set({ discoverFilters }),
      // Kindred is designed dark first; light and "match my device" are a click away.
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'kindred:prefs',
      // Older saved prefs have no filters; fill in the defaults.
      merge: (saved, current) => {
        const stored = (saved ?? {}) as Partial<PrefsState>
        return { ...current, ...stored, discoverFilters: { ...NO_FILTERS, ...stored.discoverFilters } }
      },
    },
  ),
)
