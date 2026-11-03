import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Heart, MessageCircleHeart, RotateCcw, SearchX, Star, X } from 'lucide-react'
import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { MatchCelebration } from '@/components/MatchCelebration'
import { ProfileDetails } from '@/components/ProfileDetails'
import { SwipeCard } from '@/components/SwipeCard'
import { FiltersButton } from '@/components/DiscoverFilters'
import { LikeCommentDialog, likedItemKey, type LikeTarget } from '@/components/LikeComment'
import { TopPicksButton } from '@/components/TopPicks'
import { EmptyState, Spinner } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { Candidate, Match, SwipeAction, SwipeResult } from '@/lib/types'
import { activeFilterCount, NO_FILTERS } from '@/lib/filters'
import { useAuth } from '@/store/auth'
import { useToasts } from '@/store/live'
import { usePrefs } from '@/store/prefs'

const VISIBLE = 3

export function DiscoverPage() {
  const queryClient = useQueryClient()
  const user = useAuth((s) => s.user)
  const filters = usePrefs((s) => s.discoverFilters)
  const setFilters = usePrefs((s) => s.setDiscoverFilters)
  const filtered = activeFilterCount(filters) > 0
  // The filters are part of the key, so changing them fetches a fresh deck.
  const discover = useQuery({ queryKey: [...keys.discover, filters], queryFn: () => api.discover(filters) })
  const [gone, setGone] = useState<Record<number, SwipeAction>>({})
  const [history, setHistory] = useState<Candidate[]>([])
  const [restored, setRestored] = useState<Candidate[]>([])
  const [lastAction, setLastAction] = useState<SwipeAction>('pass')
  const [match, setMatch] = useState<Match | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const deck = useMemo(() => {
    const fresh = (discover.data ?? []).filter(
      (c) => !(c.id in gone) && !restored.some((r) => r.id === c.id),
    )
    return [...restored, ...fresh]
  }, [discover.data, gone, restored])
  const top = deck[0]

  const [likeTarget, setLikeTarget] = useState<LikeTarget | null>(null)
  const swipe = useMutation({
    mutationFn: ({
      candidate,
      action,
      extras,
    }: {
      candidate: Candidate
      action: SwipeAction
      extras?: { liked_item?: string; comment?: string }
    }) => api.swipe(candidate.id, action, extras),
    onSuccess: (result) => {
      if (result.matched && result.match) {
        setMatch(result.match)
        void queryClient.invalidateQueries({ queryKey: keys.matches })
      }
      void queryClient.invalidateQueries({ queryKey: keys.topPicks })
    },
    onError: (error) => {
      useToasts.getState().push({ title: 'Swipe failed', body: (error as Error).message })
    },
  })

  // A swipe made from Top picks takes that person out of the deck as well.
  const onPickSwiped = (candidate: Candidate, action: SwipeAction, result: SwipeResult) => {
    setGone((g) => ({ ...g, [candidate.id]: action }))
    setRestored((r) => r.filter((c) => c.id !== candidate.id))
    if (result.matched && result.match) {
      setMatch(result.match)
      void queryClient.invalidateQueries({ queryKey: keys.matches })
    }
  }

  const undo = useMutation({
    mutationFn: api.undoSwipe,
    onSuccess: () => {
      const previous = history[history.length - 1]
      if (!previous) return
      setHistory((h) => h.slice(0, -1))
      setGone(({ [previous.id]: _, ...rest }) => rest)
      setRestored((r) => [previous, ...r.filter((c) => c.id !== previous.id)])
    },
    onError: (error) => {
      const message =
        error instanceof ApiError && error.status === 409
          ? "That one turned into a match, so it's staying."
          : (error as Error).message
      useToasts.getState().push({ title: "Can't undo", body: message })
    },
  })

  const act = useCallback(
    (action: SwipeAction, extras?: { liked_item?: string; comment?: string }) => {
      if (!top) return
      setLastAction(action)
      setDetailsOpen(false)
      setGone((g) => ({ ...g, [top.id]: action }))
      setRestored((r) => r.filter((c) => c.id !== top.id))
      setHistory((h) => [...h.slice(-9), top])
      swipe.mutate({ candidate: top, action, extras })
    },
    [top, swipe],
  )

  const sendLike = (target: LikeTarget, comment: string) => {
    setLikeTarget(null)
    act('like', { liked_item: likedItemKey(target), comment: comment || undefined })
    if (comment) useToasts.getState().push({ title: 'Like sent', body: 'Your comment goes with it.' })
  }

  // Fetch more people when the deck runs low (once per swipe, so an empty server can't loop).
  const remaining = deck.length
  const swipeCount = Object.keys(gone).length
  const refetchedAt = useRef(0)
  const { refetch, isFetching } = discover
  useEffect(() => {
    if (remaining < 4 && swipeCount > refetchedAt.current && !isFetching) {
      refetchedAt.current = swipeCount
      void refetch()
    }
  }, [remaining, swipeCount, isFetching, refetch])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (match || likeTarget || (e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'ArrowRight') act('like')
      else if (e.key === 'ArrowLeft') act('pass')
      else if (e.key === 'ArrowUp') act('super')
      else if (e.key === 'Backspace' && history.length) undo.mutate()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act, match, likeTarget, history.length, undo])

  return (
    <div className="mx-auto flex w-full max-w-6xl justify-center gap-10 px-4 pt-5 pb-6 sm:px-8 lg:pt-10">
      <section className="flex w-full max-w-[440px] flex-col items-center xl:max-w-[460px]">
        <header className="mb-4 flex w-full items-end justify-between px-1 sm:mb-5">
          <div>
            <h1 className="font-display text-4xl leading-none sm:text-5xl">Discover</h1>
            <p className="mt-2 text-sm text-muted">
              Picked for you{user?.city ? ` around ${user.city}` : ''} · best fit first
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TopPicksButton onSwiped={onPickSwiped} />
            <FiltersButton />
          </div>
        </header>

        <div className="relative h-[calc(100dvh-23.5rem)] max-h-[640px] min-h-[400px] w-full max-w-[440px] sm:aspect-[3/4.25] sm:h-auto sm:max-h-none">
          {discover.isPending ? (
            <div className="card grid size-full place-items-center">
              <Spinner className="text-coral" />
            </div>
          ) : deck.length === 0 && filtered ? (
            <div className="card grid size-full place-items-center">
              <EmptyState
                icon={<SearchX className="size-8" />}
                title="No one fits those filters"
                action={
                  <button type="button" className="btn-secondary" onClick={() => setFilters(NO_FILTERS)}>
                    Clear filters
                  </button>
                }
              >
                Try fewer filters, or a wider set of interests.
              </EmptyState>
            </div>
          ) : deck.length === 0 ? (
            <div className="card grid size-full place-items-center">
              <EmptyState
                icon={<SearchX className="size-8" />}
                title="You've seen everyone"
                action={
                  <Link to="/app/profile" className="btn-secondary">
                    Widen your preferences
                  </Link>
                }
              >
                New people join every day. Try a broader age range, or check who already likes you.
              </EmptyState>
            </div>
          ) : (
            <AnimatePresence custom={lastAction}>
              {deck
                .slice(0, VISIBLE)
                .reverse()
                .map((candidate) => {
                  const depth = deck.indexOf(candidate)
                  return (
                    <SwipeCard
                      key={candidate.id}
                      candidate={candidate}
                      depth={depth}
                      onSwipe={act}
                      onInfo={() => setDetailsOpen((open) => !open)}
                    />
                  )
                })}
            </AnimatePresence>
          )}
        </div>

        <div className="mt-5 flex items-center justify-center gap-4 sm:mt-6">
          <ActionButton
            label="Undo"
            onClick={() => undo.mutate()}
            disabled={!history.length || undo.isPending}
            className="size-12 text-apricot"
          >
            <RotateCcw className="size-5" />
          </ActionButton>
          <ActionButton label="Pass" onClick={() => act('pass')} disabled={!top} className="size-16 text-rose">
            <X className="size-8" strokeWidth={2.6} />
          </ActionButton>
          <ActionButton label="Super like" onClick={() => act('super')} disabled={!top} className="size-12 text-sky">
            <Star className="size-5 fill-current" />
          </ActionButton>
          <ActionButton
            label="Like"
            onClick={() => act('like')}
            disabled={!top}
            className="size-16 border-transparent bg-gradient-brand text-ink shadow-glow"
          >
            <Heart className="size-7 fill-current" />
          </ActionButton>
        </div>
        <p className="mt-4 hidden text-xs text-faint sm:block">
          Drag the card, or use ← pass · → like · ↑ super · ⌫ undo
        </p>
      </section>

      <aside className="hidden min-w-0 flex-1 xl:block">
        <AnimatePresence mode="wait">
          {top && (
            <motion.div
              key={top.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="sticky top-10 mt-[4.6rem] max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-[2rem] border border-line bg-surface/70 p-8 scrollbar-none"
            >
              <p className="label">About {top.name}</p>
              {top.shared_interests.length > 0 && (
                <p className="mb-6 text-sm text-apricot">
                  You both love {formatList(top.shared_interests.map((s) => s.toLowerCase()))}.
                </p>
              )}
              <ProfileDetails
                profile={top}
                shared={top.shared_interests}
                onLikePrompt={(prompt) => setLikeTarget({ kind: 'prompt', prompt })}
              />
              <button type="button" className="btn-secondary mt-6 w-full" onClick={() => setLikeTarget({ kind: 'profile' })}>
                <MessageCircleHeart className="size-4 text-coral" /> Like with a comment
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </aside>

      <AnimatePresence>
        {detailsOpen && top && (
          <motion.div
            className="fixed inset-0 z-40 flex items-end justify-center bg-ink/60 backdrop-blur-sm xl:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDetailsOpen(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-[2rem] border-t border-line-strong bg-surface p-6 pb-10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-line-strong" />
              <ProfileDetails
                profile={top}
                shared={top.shared_interests}
                onLikePrompt={(prompt) => setLikeTarget({ kind: 'prompt', prompt })}
              />
              <button type="button" className="btn-secondary mt-6 w-full" onClick={() => setLikeTarget({ kind: 'profile' })}>
                <MessageCircleHeart className="size-4 text-coral" /> Like with a comment
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <MatchCelebration match={match} onClose={() => setMatch(null)} />
      <LikeCommentDialog name={top?.name ?? ''} target={likeTarget} onClose={() => setLikeTarget(null)} onSend={sendLike} />
    </div>
  )
}

function ActionButton({
  label,
  className,
  children,
  ...props
}: HTMLMotionProps<'button'> & { label: string }) {
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.9 }}
      aria-label={label}
      title={label}
      className={clsx(
        'grid place-items-center rounded-full border border-line-strong bg-surface shadow-card transition-colors disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  )
}

export function formatList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
