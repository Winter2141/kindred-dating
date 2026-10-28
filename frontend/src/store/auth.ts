import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Me, Session } from '@/lib/types'

interface AuthState {
  token: string | null
  user: Me | null
  signIn: (session: Session) => void
  setUser: (user: Me) => void
  signOut: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      signIn: (session) => set({ token: session.access_token, user: session.user }),
      setUser: (user) => set({ user }),
      signOut: () => set({ token: null, user: null }),
    }),
    { name: 'kindred:auth' },
  ),
)
