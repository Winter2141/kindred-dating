import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Megaphone, PartyPopper, TriangleAlert, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { EmptyState, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { ago } from '@/lib/time'
import type { AdminAnnouncement, Announcement, AnnouncementTone } from '@/lib/types'
import { useToasts } from '@/store/live'

export const TONES: { value: AnnouncementTone; label: string; icon: ReactNode; className: string }[] = [
  {
    value: 'info',
    label: 'News',
    icon: <Megaphone className="size-4" />,
    className: 'border-sky/25 bg-sky/10 text-sky',
  },
  {
    value: 'warning',
    label: 'Heads up',
    icon: <TriangleAlert className="size-4" />,
    className: 'border-apricot/25 bg-apricot/10 text-apricot',
  },
  {
    value: 'celebration',
    label: 'Celebration',
    icon: <PartyPopper className="size-4" />,
    className: 'border-coral/25 bg-coral/10 text-coral',
  },
]

export const MAX_TITLE = 80
export const MAX_BODY = 400

function tone(value: AnnouncementTone) {
  return TONES.find((t) => t.value === value) ?? TONES[0]
}

/** How long an announcement stays up, for the form: hours, or null for "until I end it". */
export const DURATIONS: { hours: number | null; label: string }[] = [
  { hours: 24, label: 'A day' },
  { hours: 72, label: 'Three days' },
  { hours: 24 * 7, label: 'A week' },
  { hours: null, label: 'Until I end it' },
]

/** The newest announcement someone hasn't dismissed, across the top of the app. */
export function AnnouncementBanner() {
  const queryClient = useQueryClient()
  const announcements = useQuery({
    queryKey: keys.announcements,
    queryFn: api.announcements,
    // There's no live event for these, so look again now and then.
    refetchInterval: 5 * 60_000,
  })
  const dismiss = useMutation({
    mutationFn: (id: number) => api.dismissAnnouncement(id),
    onMutate: (id) =>
      queryClient.setQueryData<Announcement[]>(keys.announcements, (list) => list?.filter((a) => a.id !== id)),
    onError: () => void queryClient.invalidateQueries({ queryKey: keys.announcements }),
  })
  const current = announcements.data?.[0]
  if (!current) return null
  const style = tone(current.tone)

  return (
    <div className={clsx('flex items-start gap-3 border-b px-4 py-2.5 text-sm sm:px-6', style.className)} role="status">
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <p className="min-w-0 flex-1 text-cream/90">
        <span className="font-semibold text-cream">{current.title}</span>
        {current.body && <span className="text-cream/80"> {current.body}</span>}
      </p>
      <button
        type="button"
        onClick={() => dismiss.mutate(current.id)}
        className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-cream"
        aria-label="Dismiss announcement"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

/** The Announcements tab in Moderation: post one to everyone, and end the ones that are up. */
export function AnnouncementsPanel() {
  const list = useQuery({ queryKey: keys.adminAnnouncements, queryFn: api.adminAnnouncements })
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="card p-5 sm:p-6">
        <h2 className="font-display text-3xl">Tell everyone</h2>
        <p className="mt-1 text-sm text-muted">
          Shows as a banner at the top of the app until each person dismisses it or it ends.
        </p>
        <AnnouncementForm />
      </section>
      <section>
        <h2 className="mb-4 font-display text-3xl">Posted</h2>
        {list.isPending ? (
          <div className="grid place-items-center py-16">
            <Spinner className="text-coral" />
          </div>
        ) : list.isError ? (
          <p className="text-sm text-danger">Couldn't load announcements. {list.error.message}</p>
        ) : list.data.length === 0 ? (
          <EmptyState icon={<Megaphone className="size-8" />} title="Nothing posted yet">
            Planned downtime, a new feature, a safety reminder: post it here.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {list.data.map((announcement) => (
              <PostedAnnouncement key={announcement.id} announcement={announcement} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function AnnouncementForm() {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [toneValue, setTone] = useState<AnnouncementTone>('info')
  const [hours, setHours] = useState<number | null>(72)

  const post = useMutation({
    mutationFn: () => api.postAnnouncement({ title: title.trim(), body: body.trim(), tone: toneValue, hours }),
    onSuccess: () => {
      setTitle('')
      setBody('')
      void queryClient.invalidateQueries({ queryKey: keys.adminAnnouncements })
      void queryClient.invalidateQueries({ queryKey: keys.announcements })
      useToasts.getState().push({ title: 'Posted', body: 'Everyone will see it next time they open Kindred.' })
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (title.trim()) post.mutate()
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      <label className="block">
        <span className="label">Headline</span>
        <input
          className="field"
          value={title}
          maxLength={MAX_TITLE}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Video calls are here"
          required
        />
      </label>
      <label className="block">
        <span className="label">More detail (optional)</span>
        <textarea
          className="field min-h-24 resize-y"
          value={body}
          maxLength={MAX_BODY}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <p className="-mt-2 text-right text-xs text-faint">
        {body.length}/{MAX_BODY}
      </p>
      <fieldset>
        <legend className="label">Kind</legend>
        <div className="flex flex-wrap gap-2">
          {TONES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={toneValue === t.value}
              onClick={() => setTone(t.value)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                toneValue === t.value ? t.className : 'border-line text-muted hover:text-cream',
              )}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="label">Keep it up for</span>
        <select
          className="field"
          value={hours === null ? 'open' : String(hours)}
          onChange={(e) => setHours(e.target.value === 'open' ? null : Number(e.target.value))}
        >
          {DURATIONS.map((d) => (
            <option key={d.label} value={d.hours === null ? 'open' : String(d.hours)}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={!title.trim() || post.isPending}>
          {post.isPending && <Spinner className="size-4" />} Post to everyone
        </button>
        {post.isError && <p className="text-sm text-danger">{post.error.message}</p>}
      </div>
    </form>
  )
}

function PostedAnnouncement({ announcement }: { announcement: AdminAnnouncement }) {
  const queryClient = useQueryClient()
  const end = useMutation({
    mutationFn: () => api.endAnnouncement(announcement.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.adminAnnouncements })
      void queryClient.invalidateQueries({ queryKey: keys.announcements })
    },
  })
  const style = tone(announcement.tone)
  return (
    <li className="card p-4">
      <div className="flex items-start gap-3">
        <span className={clsx('grid size-8 shrink-0 place-items-center rounded-full border', style.className)}>
          {style.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-cream">{announcement.title}</p>
          {announcement.body && <p className="mt-1 text-sm text-muted">{announcement.body}</p>}
          <p className="mt-2 text-xs text-faint">
            {announcement.author_name ?? 'A moderator'} · {ago(announcement.created_at)} ·{' '}
            {announcement.dismissed_count} dismissed
          </p>
        </div>
        {announcement.active ? (
          <button
            type="button"
            className="btn-ghost shrink-0 text-sm"
            disabled={end.isPending}
            onClick={() => end.mutate()}
          >
            {end.isPending ? <Spinner className="size-4" /> : 'End now'}
          </button>
        ) : (
          <span className="shrink-0 rounded-full bg-raised px-2.5 py-1 text-xs text-muted">Ended</span>
        )}
      </div>
    </li>
  )
}
