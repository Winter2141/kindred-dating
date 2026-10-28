import { create } from 'zustand'
import type { ConnectionStatus } from '@/lib/realtime'

interface LiveState {
  status: ConnectionStatus
  online: Record<number, boolean>
  /** match id -> user id currently typing there */
  typing: Record<number, number | undefined>
  /** The conversation on screen, so its messages don't count as unread. */
  activeMatchId: number | null
  setActiveMatch: (matchId: number | null) => void
  setStatus: (status: ConnectionStatus) => void
  setOnline: (userId: number, online: boolean) => void
  resetOnline: (userIds: number[]) => void
  setTyping: (matchId: number, userId: number | undefined) => void
}

export const useLive = create<LiveState>()((set) => ({
  status: 'idle',
  online: {},
  typing: {},
  activeMatchId: null,
  setActiveMatch: (activeMatchId) => set({ activeMatchId }),
  setStatus: (status) => set({ status }),
  setOnline: (userId, online) => set((s) => ({ online: { ...s.online, [userId]: online } })),
  resetOnline: (userIds) => set({ online: Object.fromEntries(userIds.map((id) => [id, true])) }),
  setTyping: (matchId, userId) => set((s) => ({ typing: { ...s.typing, [matchId]: userId } })),
}))

export interface Toast {
  id: number
  title: string
  body?: string
  image?: string
  href?: string
}

interface ToastState {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

let nextToastId = 1

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = nextToastId++
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...toast, id }] }))
    setTimeout(() => get().dismiss(id), 5000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
