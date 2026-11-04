import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Heart, Undo2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { VisitingBadge } from '@/components/Travel'
import { VerifiedBadge } from '@/components/Verification'
import { EmptyState, Photo, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { shortAgo } from '@/lib/time'
import type { Match, PublicProfile, SavedProfile, SwipeAction } from '@/lib/types'
import { useToasts } from '@/store/live'

/** People set aside from Discover to decide on later. Liking, passing or putting back clears them. */
export function SavedList({
  onOpen,
  onMatch,
}: {
  onOpen: (profile: PublicProfile) => void
  onMatch: (match: Match) => void
}) {
  const queryClient = useQueryClient()
  const saved = useQuery({ queryKey: keys.saved, queryFn: api.saved })
  const drop = (id: number) =>
    queryClient.setQueryData<SavedProfile[]>(keys.saved, (list) => list?.filter((s) => s.user.id !== id))

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: SwipeAction }) => api.swipe(id, action),
    onMutate: ({ id }) => drop(id),
    onSuccess: (result) => {
      if (result.match) onMatch(result.match)
      void queryClient.invalidateQueries({ queryKey: keys.matches })
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: keys.saved })
      useToasts.getState().push({ title: "Couldn't do that", body: error.message })
    },
  })
  const putBack = useMutation({
    mutationFn: (id: number) => api.unsaveProfile(id),
    onMutate: drop,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.discover }),
    onError: () => void queryClient.invalidateQueries({ queryKey: keys.saved }),
  })

  if (saved.isPending) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="text-coral" />
      </div>
    )
  }
  if (saved.isError)
    return <p className="text-sm text-danger">Couldn't load your saved profiles. {saved.error.message}</p>
  if (saved.data.length === 0) {
    return (
      <EmptyState
        icon={<Bookmark className="size-8" />}
        title="Nobody saved yet"
        action={
          <Link to="/app/discover" className="btn-primary">
            Back to Discover
          </Link>
        }
      >
        Not sure yet? Tap the bookmark on a card to set them aside without swiping. They'll wait here for you.
      </EmptyState>
    )
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {saved.data.map(({ user, saved_at }) => (
        <li key={user.id} className="card flex items-center gap-4 p-3">
          <button
            type="button"
            onClick={() => onOpen(user)}
            className="flex min-w-0 flex-1 items-center gap-4 text-left"
            aria-label={`View ${user.name}'s profile`}
          >
            <span className="block size-16 shrink-0 overflow-hidden rounded-2xl [container-type:inline-size]">
              <Photo src={user.photos[0]} name={user.name} className="size-full" />
            </span>
            <span className="block min-w-0">
              <span className="flex items-center gap-1.5 font-display text-2xl leading-none">
                <span className="truncate">{user.name}</span>
                <span className="text-muted">{user.age}</span>
                {user.verified && <VerifiedBadge className="size-4.5 shrink-0" />}
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span>Saved {shortAgo(saved_at)}</span>
                {user.visiting && <VisitingBadge place={user.visiting} />}
              </span>
            </span>
          </button>
          <div className="flex shrink-0 gap-1.5">
            <IconButton label={`Put ${user.name} back in Discover`} onClick={() => putBack.mutate(user.id)}>
              <Undo2 className="size-4 text-muted" />
            </IconButton>
            <IconButton label={`Pass on ${user.name}`} onClick={() => decide.mutate({ id: user.id, action: 'pass' })}>
              <X className="size-4 text-rose" />
            </IconButton>
            <IconButton
              label={`Like ${user.name}`}
              onClick={() => decide.mutate({ id: user.id, action: 'like' })}
              primary
            >
              <Heart className="size-4 fill-current" />
            </IconButton>
          </div>
        </li>
      ))}
    </ul>
  )
}

function IconButton({
  label,
  onClick,
  primary,
  children,
}: {
  label: string
  onClick: () => void
  primary?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        primary
          ? 'grid size-10 place-items-center rounded-full bg-gradient-brand text-ink shadow-glow transition hover:scale-105'
          : 'grid size-10 place-items-center rounded-full border border-line-strong bg-raised transition hover:scale-105'
      }
    >
      {children}
    </button>
  )
}
