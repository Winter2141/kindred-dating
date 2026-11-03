/** Keyboard shortcuts: which keys do what, and a small matcher for two-key sequences. */

export interface Shortcut {
  keys: string[]
  label: string
}

export interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

/** "g" then a letter jumps to a page, like GitHub or Gmail. */
export const GO_TO: Record<string, { path: string; label: string }> = {
  d: { path: '/app/discover', label: 'Discover' },
  l: { path: '/app/likes', label: 'Likes' },
  c: { path: '/app/matches', label: 'Chats' },
  p: { path: '/app/profile', label: 'Profile' },
  i: { path: '/app/insights', label: 'Insights' },
  s: { path: '/app/settings', label: 'Settings' },
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    shortcuts: [
      { keys: ['?'], label: 'Show these shortcuts' },
      ...Object.entries(GO_TO).map(([key, { label }]) => ({ keys: ['g', key], label: `Go to ${label}` })),
    ],
  },
  {
    title: 'Discover',
    shortcuts: [
      { keys: ['→'], label: 'Like' },
      { keys: ['←'], label: 'Pass' },
      { keys: ['↑'], label: 'Super like' },
      { keys: ['Backspace'], label: 'Undo the last swipe' },
    ],
  },
  {
    title: 'Chats',
    shortcuts: [
      { keys: ['/'], label: 'Search people and messages' },
      { keys: ['Alt', '↑'], label: 'Previous conversation' },
      { keys: ['Alt', '↓'], label: 'Next conversation' },
      { keys: ['Enter'], label: 'Send' },
      { keys: ['Shift', 'Enter'], label: 'New line' },
      { keys: ['↑'], label: 'Edit your last message (empty box)' },
      { keys: ['Esc'], label: 'Cancel a reply or edit' },
    ],
  },
]

/** True when a key press belongs to a text field rather than to the shortcuts. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select'))
}

/**
 * Feeds single keys in and reports a completed "g x" sequence. The second key has to come
 * within `windowMs`, so a stray "g" doesn't hijack the next unrelated key press.
 */
export function createSequenceMatcher(windowMs = 1200, now: () => number = Date.now) {
  let pendingAt: number | null = null
  return (key: string): string | null => {
    const lower = key.toLowerCase()
    if (pendingAt !== null && now() - pendingAt <= windowMs) {
      pendingAt = null
      return GO_TO[lower] ? lower : null
    }
    pendingAt = lower === 'g' ? now() : null
    return null
  }
}

/** The conversation before or after the open one, wrapping around. */
export function neighbour(ids: number[], current: number | null, step: 1 | -1): number | undefined {
  if (ids.length === 0) return undefined
  const index = current === null ? -1 : ids.indexOf(current)
  if (index === -1) return step === 1 ? ids[0] : ids[ids.length - 1]
  return ids[(index + step + ids.length) % ids.length]
}
