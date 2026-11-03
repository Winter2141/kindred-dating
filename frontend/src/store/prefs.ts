import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PrefsState {
  /** Show system notifications while Kindred is in a background tab. */
  desktopNotifications: boolean
  setDesktopNotifications: (on: boolean) => void
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      desktopNotifications: false,
      setDesktopNotifications: (desktopNotifications) => set({ desktopNotifications }),
    }),
    { name: 'kindred:prefs' },
  ),
)
