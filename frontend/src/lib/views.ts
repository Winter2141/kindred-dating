import { useEffect, useRef } from 'react'
import { api } from '@/lib/api'

/** How long a profile has to stay open before it counts as a look, not a scroll past. */
export const VIEW_AFTER_MS = 3000

/**
 * Tells the server once that this profile was looked at properly: open for VIEW_AFTER_MS.
 * Switching to another profile or closing it sooner doesn't count. Failures are ignored,
 * since a missed view isn't worth bothering anyone about.
 */
export function useRecordView(userId: number | null | undefined, open: boolean, delay = VIEW_AFTER_MS) {
  const recorded = useRef(new Set<number>())
  useEffect(() => {
    if (!open || userId == null || recorded.current.has(userId)) return
    const timer = window.setTimeout(() => {
      recorded.current.add(userId)
      api.recordView(userId).catch(() => {})
    }, delay)
    return () => window.clearTimeout(timer)
  }, [userId, open, delay])
}

/** True while the screen is wide enough for Discover's always-open profile panel (xl). */
export function wideScreen(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 80rem)').matches
}
