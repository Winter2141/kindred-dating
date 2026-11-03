import { Heart, MessageCircleHeart, Quote } from 'lucide-react'
import { useState } from 'react'
import type { LikedItem, Prompt } from '@/lib/types'
import { Dialog } from './ui'

export const MAX_COMMENT = 200

/** What a like is about: a prompt of theirs, or the person as a whole. */
export type LikeTarget = { kind: 'prompt'; prompt: Prompt } | { kind: 'profile' }

export function likedItemKey(target: LikeTarget): string | undefined {
  return target.kind === 'prompt' ? `prompt:${target.prompt.question}` : undefined
}

/** The small heart on a prompt card that starts a like about that prompt. */
export function LikePromptButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-coral shadow-card transition hover:scale-105 hover:bg-raised"
      aria-label={`Like ${name}'s prompt with a comment`}
      title="Like with a comment"
    >
      <Heart className="size-4.5" />
    </button>
  )
}

/** Write a comment to go with a like. It opens the chat if they like you back. */
export function LikeCommentDialog({
  name,
  target,
  onClose,
  onSend,
}: {
  name: string
  target: LikeTarget | null
  onClose: () => void
  onSend: (target: LikeTarget, comment: string) => void
}) {
  const [comment, setComment] = useState('')
  const close = () => {
    setComment('')
    onClose()
  }
  return (
    <Dialog open={target !== null} onClose={close} title={`Like ${name}`}>
      {target && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            onSend(target, comment.trim())
            setComment('')
          }}
        >
          {target.kind === 'prompt' && (
            <figure className="rounded-3xl border border-line bg-raised/60 p-5">
              <figcaption className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-muted uppercase">
                <Quote className="size-3.5 text-coral" /> {target.prompt.question}
              </figcaption>
              <blockquote className="mt-2 font-display text-2xl leading-snug">{target.prompt.answer}</blockquote>
            </figure>
          )}
          <label className="block">
            <span className="mb-2 flex justify-between">
              <span className="label mb-0">Add a comment</span>
              <span className="text-xs text-faint">
                {comment.length}/{MAX_COMMENT}
              </span>
            </span>
            <textarea
              className="field min-h-24 resize-none"
              maxLength={MAX_COMMENT}
              autoFocus
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={target.kind === 'prompt' ? 'Say what caught your eye…' : `Something to start with ${name}…`}
            />
          </label>
          <p className="flex items-center gap-2 text-xs text-faint">
            <MessageCircleHeart className="size-4 text-coral" /> If {name} likes you back, this opens your chat.
          </p>
          <button type="submit" className="btn-primary w-full py-3.5">
            <Heart className="size-4 fill-current" /> {comment.trim() ? 'Send like' : 'Like without a comment'}
          </button>
        </form>
      )}
    </Dialog>
  )
}

/** On a Likes card: what they wrote, and what it was about. */
export function LikeCommentNote({ comment, item }: { comment: string | null; item: LikedItem | null }) {
  if (!comment && !item) return null
  return (
    <div className="rounded-2xl bg-ink/70 px-3 py-2 text-left text-xs backdrop-blur">
      {item?.kind === 'prompt' && <p className="truncate text-cream/60">On “{item.question}”</p>}
      {comment && <p className="line-clamp-2 text-[13px] text-cream">“{comment}”</p>}
    </div>
  )
}
