import { useMutation } from '@tanstack/react-query'
import clsx from 'clsx'
import { RefreshCw, Sparkles, WandSparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Spinner, useMeta } from '@/components/ui'
import { api } from '@/lib/api'
import type { AdminReport, BioTone, Ideas, ReportSummary } from '@/lib/types'

const TONES: { value: BioTone; label: string }[] = [
  { value: 'warm', label: 'Warm' },
  { value: 'funny', label: 'Funny' },
  { value: 'direct', label: 'Direct' },
]

/** Says where suggestions came from, and that they're only suggestions. */
export function SourceNote({ source, aiEnabled }: { source: Ideas['source']; aiEnabled: boolean }) {
  return (
    <p className="text-xs text-faint">
      {source === 'ai'
        ? 'Written with AI (OpenAI) from what’s on your profiles. Edit it before you send it.'
        : aiEnabled
          ? 'AI is busy right now, so these are simpler built-in ideas.'
          : 'Built-in ideas. With an OpenAI key set up, these are written for you two.'}
    </p>
  )
}

function IdeaList({
  ideas,
  onPick,
  pickLabel,
}: {
  ideas: string[]
  onPick: (idea: string) => void
  pickLabel: string
}) {
  return (
    <ul className="space-y-2">
      {ideas.map((idea) => (
        <li key={idea}>
          <button
            type="button"
            onClick={() => onPick(idea)}
            className="block w-full rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-left text-sm text-cream/90 transition hover:border-coral/50"
            aria-label={`${pickLabel}: ${idea}`}
          >
            {idea}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** "Help me write" under the bio field: three bios in a chosen tone, from the profile and draft. */
export function BioHelper({ draft, onUse }: { draft: string; onUse: (bio: string) => void }) {
  const { data: meta } = useMeta()
  const [open, setOpen] = useState(false)
  const [tone, setTone] = useState<BioTone>('warm')
  const suggest = useMutation({ mutationFn: (t: BioTone) => api.bioIdeas(draft, t) })

  const ask = (t: BioTone) => {
    setTone(t)
    suggest.mutate(t)
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-ghost mt-2 text-sm"
        onClick={() => {
          setOpen(true)
          ask(tone)
        }}
      >
        <WandSparkles className="size-4 text-apricot" /> Help me write
      </button>
    )
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-line bg-raised/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Tone" className="inline-flex rounded-full border border-line bg-surface p-1">
          {TONES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={tone === t.value}
              disabled={suggest.isPending}
              onClick={() => ask(t.value)}
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-semibold transition',
                tone === t.value ? 'bg-raised text-cream shadow-card' : 'text-muted hover:text-cream',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface hover:text-cream"
            onClick={() => ask(tone)}
            disabled={suggest.isPending}
            aria-label="More ideas"
            title="More ideas"
          >
            <RefreshCw className="size-4" />
          </button>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface hover:text-cream"
            onClick={() => setOpen(false)}
            aria-label="Close writing help"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      {suggest.isPending ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted">
          <Spinner className="size-4 text-coral" /> Writing a few ideas…
        </div>
      ) : suggest.isError ? (
        <p className="text-sm text-danger">Couldn’t get ideas. {suggest.error.message}</p>
      ) : suggest.data ? (
        <>
          <IdeaList
            ideas={suggest.data.ideas}
            pickLabel="Use this bio"
            onPick={(bio) => {
              onUse(bio)
              setOpen(false)
            }}
          />
          <SourceNote source={suggest.data.source} aiEnabled={Boolean(meta?.ai_enabled)} />
        </>
      ) : null}
    </div>
  )
}

/** The sparkle button in a chat's composer: openers for a new chat, or replies to the last message. */
export function MessageIdeasButton({
  matchId,
  name,
  onPick,
  disabled,
}: {
  matchId: number
  name: string
  onPick: (text: string) => void
  disabled?: boolean
}) {
  const { data: meta } = useMeta()
  const [open, setOpen] = useState(false)
  const suggest = useMutation({ mutationFn: () => api.messageIdeas(matchId) })
  const panel = useRef<HTMLDivElement>(null)

  // Close on Escape or a click elsewhere.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <div ref={panel} className="shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o)
          if (!open) suggest.mutate()
        }}
        className={clsx(
          'grid size-11 place-items-center rounded-full transition hover:bg-surface hover:text-cream disabled:opacity-40',
          open ? 'text-apricot' : 'text-muted',
        )}
        aria-label="Suggest a message"
        aria-expanded={open}
        title="Suggest a message"
      >
        <Sparkles className="size-5" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Message ideas"
          className="absolute inset-x-0 bottom-full z-20 mb-2 max-w-md space-y-3 rounded-3xl border border-line-strong bg-raised p-4 shadow-card"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Ideas for {name}</p>
            <button
              type="button"
              className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface hover:text-cream"
              onClick={() => suggest.mutate()}
              disabled={suggest.isPending}
              aria-label="More ideas"
              title="More ideas"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>
          {suggest.isPending ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted">
              <Spinner className="size-4 text-coral" /> Thinking…
            </div>
          ) : suggest.isError ? (
            <p className="text-sm text-danger">Couldn’t get ideas. {suggest.error.message}</p>
          ) : suggest.data ? (
            <>
              <IdeaList
                ideas={suggest.data.ideas}
                pickLabel="Use this message"
                onPick={(idea) => {
                  onPick(idea)
                  setOpen(false)
                }}
              />
              <SourceNote source={suggest.data.source} aiEnabled={Boolean(meta?.ai_enabled)} />
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

const ACTIONS: Record<ReportSummary['suggested_action'], { label: string; className: string }> = {
  dismiss: { label: 'Suggests: dismiss', className: 'bg-raised text-muted' },
  warn: { label: 'Suggests: warn', className: 'bg-apricot/12 text-apricot' },
  ban: { label: 'Suggests: ban', className: 'bg-danger/12 text-danger' },
}

/** On a report card: a model's neutral read of the report and the messages saved with it. */
export function ReportSummaryPanel({ report }: { report: AdminReport }) {
  const { data: meta } = useMeta()
  const summarise = useMutation({ mutationFn: () => api.reportSummary(report.id) })
  if (!meta?.ai_enabled) return null

  if (!summarise.data) {
    return (
      <div className="mt-3">
        <button
          type="button"
          className="btn-ghost text-sm"
          disabled={summarise.isPending}
          onClick={() => summarise.mutate()}
        >
          {summarise.isPending ? <Spinner className="size-4" /> : <Sparkles className="size-4 text-apricot" />}{' '}
          Summarise with AI
        </button>
        {summarise.isError && <p className="mt-1 text-sm text-danger">{summarise.error.message}</p>}
      </div>
    )
  }
  const { summary, concerns, suggested_action } = summarise.data
  return (
    <div className="mt-3 rounded-2xl border border-line bg-raised/60 p-4 text-sm" aria-label="AI summary">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-semibold tracking-wide text-muted uppercase">
          <Sparkles className="size-3.5 text-apricot" /> AI summary
        </span>
        <span className={clsx('rounded-full px-2 py-0.5 text-xs font-semibold', ACTIONS[suggested_action].className)}>
          {ACTIONS[suggested_action].label}
        </span>
      </div>
      <p className="text-cream/90">{summary}</p>
      {concerns.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          {concerns.map((concern) => (
            <li key={concern}>{concern}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-faint">A suggestion to help you triage. You make the call.</p>
    </div>
  )
}
