import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff, Heart } from 'lucide-react'
import { Link } from 'react-router'
import { VisitingBadge } from '@/components/Travel'
import { VerifiedBadge } from '@/components/Verification'
import { EmptyState, Photo, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { shortAgo } from '@/lib/time'
import type { Viewer } from '@/lib/types'

/** "Looked once", "Looked 3 times". */
export function timesLabel(times: number): string {
  return times === 1 ? 'Looked once' : `Looked ${times} times`
}

/** People who opened your profile in the last 30 days, newest first. */
export function ViewedYouList({ onOpen }: { onOpen: (viewer: Viewer) => void }) {
  const views = useQuery({ queryKey: keys.viewers, queryFn: api.viewers })

  if (views.isPending) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="text-coral" />
      </div>
    )
  }
  if (views.isError) return <p className="text-sm text-danger">Couldn't load who viewed you. {views.error.message}</p>
  if (views.data.private) {
    return (
      <EmptyState
        icon={<EyeOff className="size-8" />}
        title="You're browsing privately"
        action={
          <Link to="/app/settings" className="btn-secondary">
            Change in Settings
          </Link>
        }
      >
        Nobody sees when you look at their profile, so you don't see who looked at yours. It's only fair.
      </EmptyState>
    )
  }
  if (views.data.viewers.length === 0) {
    return (
      <EmptyState
        icon={<Eye className="size-8" />}
        title="No views in the last 30 days"
        action={
          <Link to="/app/profile" className="btn-primary">
            Polish your profile
          </Link>
        }
      >
        When someone opens your full profile, they'll show up here. A clear first photo gets more people to tap in.
      </EmptyState>
    )
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {views.data.viewers.map((viewer) => (
        <li key={viewer.user.id}>
          <button
            type="button"
            onClick={() => onOpen(viewer)}
            className="card flex w-full items-center gap-4 p-3 text-left transition hover:border-line-strong"
            aria-label={`${viewer.user.name}, ${timesLabel(viewer.times).toLowerCase()}`}
          >
            <span className="block size-16 shrink-0 overflow-hidden rounded-2xl [container-type:inline-size]">
              <Photo src={viewer.user.photos[0]} name={viewer.user.name} className="size-full" />
            </span>
            <span className="block min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-display text-2xl leading-none">
                <span className="truncate">{viewer.user.name}</span>
                <span className="text-muted">{viewer.user.age}</span>
                {viewer.user.verified && <VerifiedBadge className="size-4.5 shrink-0" />}
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span>
                  {timesLabel(viewer.times)} · {shortAgo(viewer.viewed_at)}
                </span>
                {viewer.liked_you && (
                  <span className="inline-flex items-center gap-1 font-semibold text-coral">
                    <Heart className="size-3 fill-current" /> Likes you
                  </span>
                )}
                {viewer.user.visiting && <VisitingBadge place={viewer.user.visiting} />}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
