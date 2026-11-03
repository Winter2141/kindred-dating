import clsx from 'clsx'
import { CornerUpLeft, X } from 'lucide-react'
import { motion } from 'motion/react'
import { quoteAuthor, quoteText } from '@/lib/quotes'
import type { QuotedMessage } from '@/lib/types'

export { QUOTE_LENGTH, quoteAuthor, quoteOf, quoteText } from '@/lib/quotes'

/** The quoted message shown inside a reply bubble. Clicking it jumps to the original. */
export function QuoteBlock({
  quote,
  meId,
  otherName,
  mine,
  onJump,
}: {
  quote: QuotedMessage
  meId: number
  otherName: string
  mine: boolean
  onJump: (messageId: number) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(quote.id)}
      className={clsx(
        'mb-1.5 flex w-full min-w-0 items-stretch gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] leading-snug transition',
        mine ? 'bg-ink/15 hover:bg-ink/25' : 'bg-surface/80 hover:bg-surface',
      )}
      aria-label={`Replying to ${quoteAuthor(quote, meId, otherName)}: ${quoteText(quote)}. Show original`}
    >
      <span className={clsx('w-0.5 shrink-0 rounded-full', mine ? 'bg-ink/50' : 'bg-coral')} aria-hidden />
      <span className="min-w-0">
        <span className={clsx('block text-[11px] font-bold', mine ? 'text-ink/80' : 'text-coral')}>
          {quoteAuthor(quote, meId, otherName)}
        </span>
        <span className={clsx('line-clamp-2 break-words', quote.deleted_at && 'italic', mine ? 'text-ink/75' : 'text-muted')}>
          {quoteText(quote)}
        </span>
      </span>
    </button>
  )
}

/** Above the composer while you're writing a reply. */
export function ReplyBanner({
  quote,
  meId,
  otherName,
  onCancel,
}: {
  quote: QuotedMessage
  meId: number
  otherName: string
  onCancel: () => void
}) {
  const author = quoteAuthor(quote, meId, otherName)
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-2xl border border-line bg-raised/70 py-2 pr-2 pl-3"
    >
      <CornerUpLeft className="size-4 shrink-0 text-coral" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-xs font-semibold text-coral">Replying to {author === 'You' ? 'yourself' : author}</p>
        <p className="truncate text-muted">{quoteText(quote)}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface hover:text-cream"
        aria-label="Cancel reply"
      >
        <X className="size-4" />
      </button>
    </motion.div>
  )
}

/** The hover shortcut next to a bubble; phones use the message menu or a swipe instead. */
export function ReplyButton({ onReply }: { onReply: () => void }) {
  return (
    <button
      type="button"
      onClick={onReply}
      className="hidden size-8 shrink-0 place-items-center rounded-full text-faint transition group-hover:opacity-100 hover:bg-raised hover:text-cream focus-visible:opacity-100 sm:grid sm:opacity-0"
      aria-label="Reply"
      title="Reply"
    >
      <CornerUpLeft className="size-4" />
    </button>
  )
}

/** How far a bubble has to be dragged sideways to start a reply. */
export const SWIPE_TO_REPLY_PX = 56

/** Scroll the original message into view and flash it. Returns false if it isn't loaded. */
export function jumpToMessage(messageId: number): boolean {
  const el = document.getElementById(`message-${messageId}`)
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('flash-highlight')
  // Restart the animation even if the same message is jumped to twice in a row.
  void el.offsetWidth
  el.classList.add('flash-highlight')
  setTimeout(() => el.classList.remove('flash-highlight'), 1600)
  return true
}
