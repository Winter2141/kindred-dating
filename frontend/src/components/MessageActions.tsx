import clsx from 'clsx'
import { Copy, CornerUpLeft, MoreHorizontal, Pencil, Undo2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Message } from '@/lib/types'

/** Matches the server's window; after this the Unsend option disappears. */
export const UNSEND_WINDOW_MS = 15 * 60 * 1000

export function canUnsend(message: Message, meId: number, now = Date.now()): boolean {
  return (
    message.sender_id === meId &&
    !message.pending &&
    !message.deleted_at &&
    !message.call_kind &&
    now - new Date(message.created_at).getTime() < UNSEND_WINDOW_MS
  )
}

/** Same window as unsend; a photo can always lose or change its caption. Voice notes are final. */
export function canEdit(message: Message, meId: number, now = Date.now()): boolean {
  return canUnsend(message, meId, now) && !message.audio_url
}

/** The latest message of mine that can still be edited, for the ↑ shortcut. */
export function lastEditable(messages: Message[] | undefined, meId: number, now = Date.now()): Message | undefined {
  return [...(messages ?? [])].reverse().find((m) => canEdit(m, meId, now))
}

/** Above the composer while you edit a message. */
export function EditBanner({ message, onCancel }: { message: Message; onCancel: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-2xl border border-line bg-raised/70 py-2 pr-2 pl-3"
    >
      <Pencil className="size-4 shrink-0 text-apricot" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-xs font-semibold text-apricot">Editing message</p>
        <p className="truncate text-muted">{message.image_url ? 'Photo caption' : message.body}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface hover:text-cream"
        aria-label="Cancel editing"
      >
        <X className="size-4" />
      </button>
    </motion.div>
  )
}

export function MessageMenu({
  message,
  meId,
  onUnsend,
  onReply,
  onEdit,
  align,
}: {
  message: Message
  meId: number
  onUnsend: (message: Message) => void
  onReply?: (message: Message) => void
  onEdit?: (message: Message) => void
  align: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const copy = async () => {
    await navigator.clipboard?.writeText(message.body)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
      setOpen(false)
    }, 900)
  }

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'grid size-8 place-items-center rounded-full text-faint transition hover:bg-raised hover:text-cream focus-visible:opacity-100',
          open ? 'bg-raised text-cream opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100',
        )}
        aria-label="Message options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="size-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className={clsx(
              'glass absolute bottom-10 z-20 w-44 rounded-2xl border border-line-strong p-1.5 shadow-card',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {onReply && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onReply(message)
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-raised"
              >
                <CornerUpLeft className="size-4" /> Reply
              </button>
            )}
            {message.body && (
              <button
                type="button"
                role="menuitem"
                onClick={copy}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-raised"
              >
                <Copy className="size-4" /> {copied ? 'Copied' : 'Copy text'}
              </button>
            )}
            {onEdit && canEdit(message, meId) && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onEdit(message)
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-raised"
              >
                <Pencil className="size-4" /> Edit
              </button>
            )}
            {canUnsend(message, meId) && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onUnsend(message)
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-raised"
              >
                <Undo2 className="size-4" /> Unsend
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
