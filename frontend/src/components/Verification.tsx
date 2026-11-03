import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { BadgeCheck, Camera, Check, Clock, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { photoProblem } from '@/lib/photos'
import { ago } from '@/lib/time'
import type { VerificationReview, VerificationState } from '@/lib/types'
import { useToasts } from '@/store/live'
import { EmptyState, Photo, Spinner } from './ui'

/** The little blue tick next to a verified person's name. */
export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <BadgeCheck
      className={clsx('inline-block shrink-0 fill-sky/20 text-sky', className ?? 'size-[1em]')}
      aria-label="Photo verified"
      role="img"
    >
      <title>Photo verified</title>
    </BadgeCheck>
  )
}

/** In Settings: get a pose, send a selfie copying it, and see where review is at. */
export function VerificationFlow({ hasPhotos }: { hasPhotos: boolean }) {
  const queryClient = useQueryClient()
  const state = useQuery({ queryKey: keys.verification, queryFn: api.verification })
  const file = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const set = (next: VerificationState) => queryClient.setQueryData(keys.verification, next)
  const failed = (error: Error) => useToasts.getState().push({ title: 'Verification', body: error.message })

  const start = useMutation({ mutationFn: api.startVerification, onSuccess: set, onError: failed })
  const send = useMutation({
    mutationFn: (selfie: File) => api.sendSelfie(selfie),
    onSuccess: (next) => {
      set(next)
      useToasts.getState().push({ title: 'Selfie sent', body: "We'll let you know once it's been checked." })
    },
    onError: failed,
  })

  if (!state.data) return <Spinner className="text-coral" />
  const { status, pose, note } = state.data

  if (status === 'approved') {
    return (
      <p className="flex items-center gap-2 font-semibold text-sky">
        <VerifiedBadge className="size-5" /> Your photos are verified
      </p>
    )
  }
  if (status === 'pending') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Clock className="size-4 text-apricot" /> Your selfie is with our moderators. This usually takes less than a day.
      </p>
    )
  }
  if (status === 'awaiting_photo' && pose) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4 rounded-3xl border border-line bg-raised/60 p-4">
          <span className="text-5xl" aria-hidden>
            {pose.emoji}
          </span>
          <div>
            <p className="label mb-1">Copy this pose</p>
            <p className="font-display text-2xl leading-tight">{pose.text}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={send.isPending}
            onClick={() => file.current?.click()}
          >
            {send.isPending ? <Spinner className="size-4" /> : <Camera className="size-4" />} Take the selfie
          </button>
          <button type="button" className="btn-ghost" disabled={start.isPending} onClick={() => start.mutate()}>
            <RefreshCw className="size-4" /> Different pose
          </button>
        </div>
        {problem && <p className="text-sm text-danger">{problem}</p>}
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic"
          capture="user"
          className="hidden"
          aria-label="Selfie"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            e.target.value = ''
            if (!picked) return
            const issue = photoProblem(picked)
            setProblem(issue)
            if (!issue) send.mutate(picked)
          }}
        />
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {status === 'rejected' && (
        <p className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-cream">
          Last time it didn't go through: {note || 'the selfie and photos didn’t match.'}
        </p>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={!hasPhotos || start.isPending}
        onClick={() => start.mutate()}
      >
        <ShieldCheck className="size-4" /> {status === 'rejected' ? 'Try again' : 'Verify my photos'}
      </button>
      {!hasPhotos && <p className="text-sm text-faint">Add a profile photo first.</p>}
    </div>
  )
}

/** In Moderation: selfies waiting for a decision, next to the profile photo. */
export function VerificationQueue() {
  const queue = useQuery({ queryKey: keys.verificationQueue, queryFn: api.verificationQueue })
  if (queue.isPending) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner className="text-coral" />
      </div>
    )
  }
  if (!queue.data?.length) {
    return (
      <EmptyState icon={<BadgeCheck className="size-9" />} title="No selfies waiting">
        New verification requests will show up here.
      </EmptyState>
    )
  }
  return (
    <ul className="space-y-4">
      {queue.data.map((request) => (
        <li key={request.id}>
          <ReviewCard request={request} />
        </li>
      ))}
    </ul>
  )
}

function ReviewCard({ request }: { request: VerificationReview }) {
  const queryClient = useQueryClient()
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const person = request.user
  const review = useMutation({
    mutationFn: (approve: boolean) => api.reviewVerification(request.id, approve, approve ? '' : note),
    onSuccess: (_, approve) => {
      void queryClient.invalidateQueries({ queryKey: keys.verificationQueue })
      void queryClient.invalidateQueries({ queryKey: keys.moderationStats })
      useToasts.getState().push({ title: approve ? `${person.name} is verified` : 'Selfie turned down' })
    },
    onError: (error) => useToasts.getState().push({ title: "Couldn't save the review", body: error.message }),
  })

  return (
    <article className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {person.name}, {person.age}
        </h2>
        <span className="text-xs text-faint">
          Sent {request.submitted_at ? ago(request.submitted_at) : 'just now'}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Asked for: <span aria-hidden>{request.pose.emoji}</span> {request.pose.text}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <figure>
          <Photo src={person.photos[0]} name={person.name} className="aspect-[3/4] w-full rounded-2xl" />
          <figcaption className="mt-1.5 text-xs text-faint">Profile photo</figcaption>
        </figure>
        <figure>
          <Photo src={request.selfie_url ?? undefined} name={`${person.name}'s selfie`} className="aspect-[3/4] w-full rounded-2xl" />
          <figcaption className="mt-1.5 text-xs text-faint">Selfie</figcaption>
        </figure>
      </div>
      {rejecting ? (
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (note.trim()) review.mutate(false)
          }}
        >
          <input
            className="field flex-1 py-2.5"
            value={note}
            maxLength={300}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why? They'll see this, e.g. the pose isn't visible"
            aria-label="Reason for turning it down"
          />
          <button type="submit" className="btn bg-danger py-2.5 font-bold text-ink" disabled={!note.trim() || review.isPending}>
            Turn down
          </button>
          <button type="button" className="btn-ghost py-2.5" onClick={() => setRejecting(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-primary py-2.5" disabled={review.isPending} onClick={() => review.mutate(true)}>
            <Check className="size-4" /> Same person
          </button>
          <button type="button" className="btn-secondary py-2.5" onClick={() => setRejecting(true)}>
            <X className="size-4" /> Doesn't match
          </button>
        </div>
      )}
    </article>
  )
}
