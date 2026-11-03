import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Archive, ArchiveRestore, Bell, BellOff, ChevronLeft, MoreHorizontal, Pin, PinOff } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { api, type ChatSettingsChange } from '@/lib/api'
import { applyChatSettings, keys } from '@/lib/cache'
import type { Match } from '@/lib/types'
import { useToasts } from '@/store/live'

export const MUTE_OPTIONS = [
  { value: '1h', label: 'For 1 hour' },
  { value: '8h', label: 'For 8 hours' },
  { value: '1w', label: 'For a week' },
  { value: 'always', label: 'Until I turn it back on' },
] as const

/** Tall enough for the mute options, the longest version of the menu. */
const MENU_HEIGHT = 220

/** "Muted for 2h", "Muted until Tue" or plain "Muted" for the open-ended mute. */
export function muteLabel(mutedUntil: string | null | undefined, now = Date.now()): string {
  if (!mutedUntil) return 'Muted'
  const until = new Date(mutedUntil).getTime()
  if (new Date(mutedUntil).getUTCFullYear() >= 9999) return 'Muted'
  const hours = Math.ceil((until - now) / 3_600_000)
  if (hours <= 24) return `Muted for ${Math.max(1, hours)}h`
  return `Muted until ${new Date(mutedUntil).toLocaleDateString(undefined, { weekday: 'short' })}`
}

/** Pin, mute or archive a conversation, from its row in the chat list. */
export function ChatMenu({ match }: { match: Match }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [muting, setMuting] = useState(false)
  // Rows near the bottom of the list open their menu upwards so it isn't clipped.
  const [up, setUp] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const change = useMutation({
    mutationFn: (changes: ChatSettingsChange) => api.chatSettings(match.id, changes),
    onMutate: (changes) => {
      const optimistic = {
        pinned: changes.archived ? false : (changes.pinned ?? match.pinned),
        archived: changes.pinned ? false : (changes.archived ?? match.archived),
        muted: changes.mute ? changes.mute !== 'off' : match.muted,
        muted_until: changes.mute === 'off' ? null : match.muted_until,
      }
      queryClient.setQueryData<Match[]>(keys.matches, (list) => applyChatSettings(list, match.id, optimistic))
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<Match[]>(keys.matches, (list) => applyChatSettings(list, match.id, saved))
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: keys.matches })
      useToasts.getState().push({ title: "Couldn't update that chat", body: error.message })
    },
  })

  const pick = (changes: ChatSettingsChange) => {
    change.mutate(changes)
    setOpen(false)
    setMuting(false)
  }

  const item = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-raised'
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          setUp(window.innerHeight - box.bottom < MENU_HEIGHT)
          setOpen((v) => !v)
          setMuting(false)
        }}
        className={clsx(
          'grid size-8 place-items-center rounded-full text-faint transition hover:bg-surface hover:text-cream focus-visible:opacity-100 lg:bg-raised',
          open ? 'bg-surface text-cream opacity-100' : 'opacity-100 lg:opacity-0 lg:group-hover:opacity-100',
        )}
        aria-label={`Options for your chat with ${match.user.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="size-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: up ? 4 : -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: up ? 4 : -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className={clsx(
              'glass absolute right-0 z-30 w-60 rounded-2xl border border-line-strong p-1.5 shadow-card',
              up ? 'bottom-9' : 'top-9',
            )}
          >
            {muting ? (
              <>
                <button type="button" role="menuitem" className={clsx(item, 'text-muted')} onClick={() => setMuting(false)}>
                  <ChevronLeft className="size-4" /> Mute notifications
                </button>
                {MUTE_OPTIONS.map((option) => (
                  <button key={option.value} type="button" role="menuitem" className={item} onClick={() => pick({ mute: option.value })}>
                    <span className="size-4" /> {option.label}
                  </button>
                ))}
              </>
            ) : (
              <>
                <button type="button" role="menuitem" className={item} onClick={() => pick({ pinned: !match.pinned })}>
                  {match.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  {match.pinned ? 'Unpin' : 'Pin to top'}
                </button>
                {match.muted ? (
                  <button type="button" role="menuitem" className={item} onClick={() => pick({ mute: 'off' })}>
                    <Bell className="size-4" /> Unmute
                  </button>
                ) : (
                  <button type="button" role="menuitem" className={item} onClick={() => setMuting(true)}>
                    <BellOff className="size-4" /> Mute…
                  </button>
                )}
                <button type="button" role="menuitem" className={item} onClick={() => pick({ archived: !match.archived })}>
                  {match.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                  {match.archived ? 'Move back to chats' : 'Archive'}
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
