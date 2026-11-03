import clsx from 'clsx'
import { SmilePlus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { Reaction } from '@/lib/types'
import { useMeta } from './ui'

export const DEFAULT_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👍']

/** Counts per emoji, in first-reacted order, and whether `meId` is among them. */
export function groupReactions(reactions: Reaction[] | undefined, meId: number) {
  const groups = new Map<string, { emoji: string; count: number; mine: boolean }>()
  for (const { emoji, user_id } of reactions ?? []) {
    const group = groups.get(emoji) ?? { emoji, count: 0, mine: false }
    group.count += 1
    group.mine ||= user_id === meId
    groups.set(emoji, group)
  }
  return [...groups.values()]
}

export function ReactionPicker({
  open,
  onOpenChange,
  onPick,
  align,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (emoji: string) => void
  align: 'left' | 'right'
}) {
  const { data: meta } = useMeta()
  const choices = meta?.reactions ?? DEFAULT_REACTIONS
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={clsx(
          'grid size-8 place-items-center rounded-full text-faint transition hover:bg-raised hover:text-cream focus-visible:opacity-100',
          open ? 'bg-raised text-cream opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100',
        )}
        aria-label="React"
        aria-expanded={open}
      >
        <SmilePlus className="size-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Reactions"
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.9 }}
            transition={{ duration: 0.14 }}
            className={clsx(
              'glass absolute bottom-10 z-20 flex gap-0.5 rounded-full border border-line-strong p-1 shadow-card',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {choices.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="menuitem"
                aria-label={`React ${emoji}`}
                onClick={() => {
                  onPick(emoji)
                  onOpenChange(false)
                }}
                className="grid size-10 place-items-center rounded-full text-xl transition hover:scale-125 hover:bg-raised"
              >
                {emoji}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ReactionChips({
  reactions,
  meId,
  onToggle,
  align,
}: {
  reactions: Reaction[] | undefined
  meId: number
  onToggle: (emoji: string) => void
  align: 'left' | 'right'
}) {
  const groups = groupReactions(reactions, meId)
  if (groups.length === 0) return null
  return (
    <div className={clsx('relative z-[1] -mt-1.5 flex gap-1 px-2', align === 'right' && 'justify-end')}>
      {groups.map((group) => (
        <motion.button
          key={group.emoji}
          type="button"
          initial={{ scale: 0.4 }}
          animate={{ scale: 1 }}
          onClick={() => onToggle(group.emoji)}
          aria-pressed={group.mine}
          aria-label={`${group.emoji} ${group.count}${group.mine ? ', including you' : ''}`}
          className={clsx(
            'inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-sm leading-none shadow-sm',
            group.mine ? 'border-coral/60 bg-[#3a2420]' : 'border-line-strong bg-raised',
          )}
        >
          {group.emoji}
          {group.count > 1 && <span className="text-[11px] font-semibold text-muted">{group.count}</span>}
        </motion.button>
      ))}
    </div>
  )
}
