import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Heart, Sparkles, Star, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { timeUntil } from '@/lib/time'
import type { Candidate, SwipeAction, SwipeResult, TopPick, TopPicks } from '@/lib/types'
import { useToasts } from '@/store/live'
import { ProfileDetails } from './ProfileDetails'
import { CompatibilityRing, Dialog, Photo, Spinner } from './ui'

export function TopPicksButton({
  onSwiped,
}: {
  onSwiped: (candidate: Candidate, action: SwipeAction, result: SwipeResult) => void
}) {
  const [open, setOpen] = useState(false)
  const picks = useQuery({ queryKey: keys.topPicks, queryFn: api.topPicks, staleTime: 5 * 60_000 })
  const count = picks.data?.picks.length ?? 0

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary relative shrink-0 py-2.5 pr-4 pl-3.5 whitespace-nowrap"
        aria-label={`Today's top picks${count ? `, ${count} left` : ''}`}
      >
        <Sparkles className="size-4 text-apricot" />
        <span className="hidden sm:inline">Top picks</span>
        {count > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-gradient-brand px-1.5 text-[11px] font-bold text-ink">
            {count}
          </span>
        )}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Today's top picks" wide>
        <TopPicksList
          data={picks.data}
          loading={picks.isPending}
          onSwiped={(candidate, action, result) => {
            onSwiped(candidate, action, result)
            if (result.matched) setOpen(false)
          }}
        />
      </Dialog>
    </>
  )
}

export function TopPicksList({
  data,
  loading,
  onSwiped,
}: {
  data: TopPicks | undefined
  loading: boolean
  onSwiped: (candidate: Candidate, action: SwipeAction, result: SwipeResult) => void
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<number | null>(null)
  const swipe = useMutation({
    mutationFn: ({ pick, action }: { pick: TopPick; action: SwipeAction }) => api.swipe(pick.id, action),
    onSuccess: (result, { pick, action }) => {
      queryClient.setQueryData<TopPicks>(keys.topPicks, (current) =>
        current ? { ...current, picks: current.picks.filter((p) => p.id !== pick.id) } : current,
      )
      onSwiped(pick, action, result)
    },
    onError: (error) => useToasts.getState().push({ title: 'Swipe failed', body: error.message }),
  })

  if (loading) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner className="text-coral" />
      </div>
    )
  }
  return (
    <div>
      <p className="-mt-2 mb-5 text-sm text-muted">
        A few standouts chosen for you from today's strongest fits.
        {data && ` New picks in ${timeUntil(data.refreshes_at)}.`}
      </p>
      {data?.picks.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          <AnimatePresence initial={false}>
            {data.picks.map((pick) => (
              <motion.li
                key={pick.id}
                layout
                exit={{ opacity: 0, scale: 0.9 }}
                className="overflow-hidden rounded-3xl border border-line bg-raised/60"
              >
                <div className="relative aspect-[4/3] [container-type:inline-size]">
                  <Photo src={pick.photos[0]} name={pick.name} className="size-full" />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-transparent to-transparent" />
                  <span className="absolute top-3 right-3">
                    <CompatibilityRing value={pick.compatibility} size={46} />
                  </span>
                  <div className="absolute inset-x-4 bottom-3">
                    <p className="font-display text-3xl leading-none">
                      {pick.name} <span className="text-cream/75">{pick.age}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-apricot">
                      <Sparkles className="size-3.5" /> {pick.reason}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3">
                  <button
                    type="button"
                    onClick={() => setExpanded((id) => (id === pick.id ? null : pick.id))}
                    className="btn-ghost mr-auto px-3 py-2 text-xs"
                    aria-expanded={expanded === pick.id}
                  >
                    Profile <ChevronDown className="size-3.5" />
                  </button>
                  <PickAction label={`Pass on ${pick.name}`} onClick={() => swipe.mutate({ pick, action: 'pass' })} disabled={swipe.isPending} className="text-rose">
                    <X className="size-5" />
                  </PickAction>
                  <PickAction label={`Super like ${pick.name}`} onClick={() => swipe.mutate({ pick, action: 'super' })} disabled={swipe.isPending} className="text-sky">
                    <Star className="size-4 fill-current" />
                  </PickAction>
                  <PickAction label={`Like ${pick.name}`} onClick={() => swipe.mutate({ pick, action: 'like' })} disabled={swipe.isPending} className="border-transparent bg-gradient-brand text-ink">
                    <Heart className="size-4 fill-current" />
                  </PickAction>
                </div>
                {expanded === pick.id && (
                  <div className="border-t border-line p-5">
                    <ProfileDetails profile={pick} shared={pick.shared_interests} showHeader={false} />
                  </div>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="rounded-3xl border border-dashed border-line-strong px-6 py-10 text-center text-sm text-muted">
          You've been through today's picks. Come back tomorrow for a fresh set.
        </p>
      )}
    </div>
  )
}

function PickAction({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  className: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid size-10 place-items-center rounded-full border border-line-strong bg-surface transition hover:scale-105 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}
