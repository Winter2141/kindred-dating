import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Plane } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useSaveMe } from '@/components/EmailAddress'
import { CityInput } from '@/components/ProfileFields'
import { Dialog, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { addDays, formatTripDay, shortPlace, tripBounds, tripRemaining } from '@/lib/travel'
import type { Me } from '@/lib/types'
import { useToasts } from '@/store/live'

/** The plane button on Discover: lit up while a trip is on. */
export function TravelButton({ user }: { user: Me }) {
  const [open, setOpen] = useState(false)
  const trip = user.travel ?? null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          'grid size-11 place-items-center rounded-full border transition',
          trip
            ? 'border-coral/50 bg-coral/12 text-apricot'
            : 'border-line-strong bg-raised text-muted hover:text-cream',
        )}
        aria-label={trip ? `Travel mode: ${trip.place}` : 'Travel mode'}
        title="Travel mode"
      >
        <Plane className="size-4.5" />
      </button>
      <TravelDialog open={open} onClose={() => setOpen(false)} user={user} />
    </>
  )
}

export function TravelDialog({ open, onClose, user }: { open: boolean; onClose: () => void; user: Me }) {
  return (
    <Dialog open={open} onClose={onClose} title="Travel mode">
      {/* Remounted on each open, so the form starts from the current trip. */}
      {open && <TravelForm user={user} onDone={onClose} />}
    </Dialog>
  )
}

function TravelForm({ user, onDone }: { user: Me; onDone: () => void }) {
  const queryClient = useQueryClient()
  const saveMe = useSaveMe()
  const trip = user.travel ?? null
  const bounds = tripBounds()
  const [place, setPlace] = useState(trip?.place ?? '')
  const [until, setUntil] = useState(trip?.until ?? addDays(bounds.min, 4))
  const outOfRange = until < bounds.min || until > bounds.max

  const refreshDeck = (me: Me) => {
    saveMe(me)
    void queryClient.invalidateQueries({ queryKey: keys.discover })
    void queryClient.invalidateQueries({ queryKey: keys.topPicks })
  }
  const start = useMutation({
    mutationFn: () => api.startTrip(place.trim(), until),
    onSuccess: (me) => {
      refreshDeck(me)
      onDone()
      useToasts.getState().push({
        title: `Exploring ${shortPlace(me.travel!.place)}`,
        body: `Your deck now shows people there, until ${formatTripDay(me.travel!.until)}.`,
      })
    },
  })
  const end = useMutation({
    mutationFn: api.endTrip,
    onSuccess: (me) => {
      refreshDeck(me)
      onDone()
      useToasts.getState().push({
        title: 'Welcome home',
        body: `Back to people around ${user.city || 'you'}.`,
      })
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (place.trim() && !outOfRange) start.mutate()
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="text-sm text-muted">
        Heading somewhere? Match with people there before you arrive. While the trip lasts, your deck and distances are
        measured from there, locals can find you, and your profile says you're visiting.
      </p>
      {trip && (
        <p className="rounded-2xl border border-coral/30 bg-coral/10 p-3 text-sm">
          <Plane className="mr-1.5 inline size-4 text-apricot" />
          Exploring <strong className="text-cream">{trip.place}</strong> until {formatTripDay(trip.until)} (
          {tripRemaining(trip.until)}).
        </p>
      )}
      <label className="block">
        <span className="label">Where to</span>
        <CityInput value={place} onChange={setPlace} />
      </label>
      <div>
        <label className="block">
          <span className="label">Last day there</span>
          <input
            className="field"
            type="date"
            min={bounds.min}
            max={bounds.max}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            aria-invalid={outOfRange}
            required
          />
        </label>
        <p className="mt-1.5 text-xs text-faint">Up to 30 days from today. It ends on its own after that day.</p>
      </div>
      <p role="status" className="min-h-5 text-sm text-danger">
        {outOfRange
          ? 'Pick a day between today and 30 days from now.'
          : start.isError
            ? start.error.message
            : end.isError
              ? end.error.message
              : ''}
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn-primary" disabled={!place.trim() || outOfRange || start.isPending}>
          {start.isPending && <Spinner className="size-4" />} {trip ? 'Update trip' : 'Start exploring'}
        </button>
        {trip && (
          <button type="button" className="btn-secondary" disabled={end.isPending} onClick={() => end.mutate()}>
            {end.isPending && <Spinner className="size-4" />} End trip
          </button>
        )}
      </div>
    </form>
  )
}

/** "Visiting Lisbon" on cards and profiles of people on a trip. */
export function VisitingBadge({ place, className }: { place: string; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full bg-sky/15 px-2 py-0.5 text-xs font-semibold text-sky',
        className,
      )}
      title={`Visiting ${place}`}
    >
      <Plane className="size-3" /> Visiting {shortPlace(place)}
    </span>
  )
}
