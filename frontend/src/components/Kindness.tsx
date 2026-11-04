import { HeartHandshake, Pencil, Send } from 'lucide-react'
import { useCallback } from 'react'
import { Dialog, useMeta } from '@/components/ui'
import { unkindPhrases } from '@/lib/kindness'

/** Checks a draft against the server's patterns; finds nothing until they've loaded. */
export function useKindnessCheck(): (text: string) => string[] {
  const patterns = useMeta().data?.unkind_patterns
  return useCallback((text: string) => unkindPhrases(text, patterns ?? []), [patterns])
}

export function KindnessNudge({
  phrases,
  name,
  onEdit,
  onSendAnyway,
}: {
  /** What looked unkind. Empty closes the dialog. */
  phrases: string[]
  name: string
  onEdit: () => void
  onSendAnyway: () => void
}) {
  const quoted = [...new Set(phrases)].map((phrase) => `"${phrase}"`).join(', ')
  return (
    <Dialog open={phrases.length > 0} onClose={onEdit} title="Are you sure?">
      <div className="flex gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-apricot/12 text-apricot">
          <HeartHandshake className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="leading-relaxed text-muted">
            <span className="font-semibold text-cream">{quoted}</span> might hurt. {name} is a real person, and words
            like these are why people leave dating apps. Want to put it another way?
          </p>
        </div>
      </div>
      <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" className="btn-ghost" onClick={onSendAnyway}>
          <Send className="size-4" /> Send anyway
        </button>
        <button type="button" className="btn-primary" onClick={onEdit} autoFocus>
          <Pencil className="size-4" /> Edit message
        </button>
      </div>
    </Dialog>
  )
}
