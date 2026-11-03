import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CalendarCheck, CalendarHeart, CalendarPlus, Clock, MapPin } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { activeDate, buildIcs, defaultDateTime, formatDateTime, toLocalInput, upsertDate } from '@/lib/dates'
import type { DateProposal, Match } from '@/lib/types'
import { useToasts } from '@/store/live'
import { Dialog, Spinner } from './ui'

function useDateUpdate(matchId: number) {
  const queryClient = useQueryClient()
  return (date: DateProposal) => {
    queryClient.setQueryData<DateProposal[]>(keys.dates(matchId), (list) => upsertDate(list ?? [], date))
    void queryClient.invalidateQueries({ queryKey: keys.upcomingDates })
  }
}

export function PlanDateButton({ match }: { match: Match }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-coral"
        aria-label="Plan a date"
        title="Plan a date"
      >
        <CalendarHeart className="size-5" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Plan a date with ${match.user.name}`}>
        <DateForm match={match} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  )
}

export function DateForm({ match, onDone }: { match: Match; onDone: () => void }) {
  const [place, setPlace] = useState('')
  const [when, setWhen] = useState(() => defaultDateTime())
  const [note, setNote] = useState('')
  const ideas = useQuery({ queryKey: keys.dateIdeas(match.id), queryFn: () => api.dateIdeas(match.id), staleTime: Infinity })
  const update = useDateUpdate(match.id)
  // Fixed when the form opens; the server re-checks the 30-minute lead time anyway.
  const [earliest] = useState(() => toLocalInput(new Date(Date.now() + 30 * 60 * 1000)))

  const propose = useMutation({
    mutationFn: () =>
      api.proposeDate(match.id, { place: place.trim(), starts_at: new Date(when).toISOString(), note: note.trim() }),
    onSuccess: (date) => {
      update(date)
      onDone()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        propose.mutate()
      }}
      className="space-y-5"
    >
      {ideas.data && ideas.data.length > 0 && (
        <div>
          <span className="label">Ideas for you two</span>
          <div className="flex flex-wrap gap-2">
            {ideas.data.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setPlace(idea)}
                className={clsx('chip transition hover:border-coral/50', place === idea && 'chip-shared')}
              >
                {idea}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="block">
        <span className="label">Where</span>
        <input
          className="field"
          value={place}
          maxLength={120}
          placeholder="A place, or one of the ideas above"
          onChange={(e) => setPlace(e.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className="label">When</span>
        <input
          className="field"
          type="datetime-local"
          value={when}
          min={earliest}
          onChange={(e) => setWhen(e.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className="label">Add a note (optional)</span>
        <input
          className="field"
          value={note}
          maxLength={300}
          placeholder="I'll book a table"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {propose.isError && <p className="text-sm text-danger">{propose.error.message}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" className="btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={place.trim().length < 2 || propose.isPending}>
          {propose.isPending ? <Spinner className="size-4" /> : <CalendarHeart className="size-4" />} Send proposal
        </button>
      </div>
    </form>
  )
}

function downloadIcs(date: DateProposal, withName: string) {
  const blob = new Blob([buildIcs(date, withName)], { type: 'text/calendar' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `date-with-${withName.toLowerCase()}.ics`
  link.click()
  URL.revokeObjectURL(url)
}

/** The proposal that matters right now, pinned under the chat header. */
export function DateBar({ match, meId }: { match: Match; meId: number }) {
  const dates = useQuery({ queryKey: keys.dates(match.id), queryFn: () => api.dates(match.id) })
  const date = activeDate(dates.data)
  if (!date) return null
  return <DateCard date={date} match={match} meId={meId} />
}

export function DateCard({ date, match, meId }: { date: DateProposal; match: Match; meId: number }) {
  const update = useDateUpdate(match.id)
  const name = match.user.name
  const mine = date.proposer_id === meId
  const onError = (error: Error) => useToasts.getState().push({ title: "Couldn't update the date", body: error.message })
  const respond = useMutation({
    mutationFn: (response: 'accept' | 'decline') => api.respondToDate(match.id, date.id, response),
    onSuccess: update,
    onError,
  })
  const cancel = useMutation({ mutationFn: () => api.cancelDate(match.id, date.id), onSuccess: update, onError })
  const busy = respond.isPending || cancel.isPending
  const accepted = date.status === 'accepted'

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'mx-3 mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-3xl border p-4 sm:mx-6',
        accepted ? 'border-mint/30 bg-mint/8' : 'border-coral/30 bg-coral/8',
      )}
    >
      <span
        className={clsx(
          'grid size-11 shrink-0 place-items-center rounded-2xl',
          accepted ? 'bg-mint/15 text-mint' : 'bg-coral/15 text-coral',
        )}
      >
        {accepted ? <CalendarCheck className="size-5" /> : <CalendarHeart className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">
          {accepted ? "It's a date!" : mine ? `Waiting for ${name}` : `${name} asked you out`}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate font-semibold">
          <MapPin className="size-4 shrink-0 text-coral" /> {date.place}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-cream/80">
          <Clock className="size-3.5 shrink-0" /> {formatDateTime(date.starts_at)}
          {date.note && <span className="truncate text-muted">· “{date.note}”</span>}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {date.status === 'proposed' && !mine && (
          <>
            <button type="button" className="btn-ghost py-2" disabled={busy} onClick={() => respond.mutate('decline')}>
              Decline
            </button>
            <button type="button" className="btn-primary py-2" disabled={busy} onClick={() => respond.mutate('accept')}>
              Accept
            </button>
          </>
        )}
        {date.status === 'proposed' && mine && (
          <button type="button" className="btn-ghost py-2" disabled={busy} onClick={() => cancel.mutate()}>
            Withdraw
          </button>
        )}
        {accepted && (
          <>
            <button type="button" className="btn-secondary py-2" onClick={() => downloadIcs(date, name)}>
              <CalendarPlus className="size-4" /> Add to calendar
            </button>
            <button
              type="button"
              className="btn-ghost py-2"
              disabled={busy}
              onClick={() => window.confirm(`Call off the date with ${name}?`) && cancel.mutate()}
            >
              Can't make it
            </button>
          </>
        )}
      </div>
    </motion.div>
  )
}
