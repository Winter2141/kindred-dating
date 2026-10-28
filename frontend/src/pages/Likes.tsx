import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Heart, Star, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { MatchCelebration } from '@/components/MatchCelebration'
import { ProfileDetails } from '@/components/ProfileDetails'
import { EmptyState, Photo, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { Like, Match, SwipeAction } from '@/lib/types'
import { shortAgo } from '@/lib/time'

export function LikesPage() {
  const queryClient = useQueryClient()
  const likes = useQuery({ queryKey: keys.likes, queryFn: api.likes })
  const [match, setMatch] = useState<Match | null>(null)
  const [open, setOpen] = useState<Like | null>(null)

  const respond = useMutation({
    mutationFn: ({ like, action }: { like: Like; action: SwipeAction }) =>
      api.swipe(like.user.id, action),
    onMutate: ({ like }) => {
      setOpen(null)
      queryClient.setQueryData<Like[]>(keys.likes, (list) =>
        list?.filter((l) => l.user.id !== like.user.id),
      )
    },
    onSuccess: (result) => {
      if (result.match) setMatch(result.match)
      void queryClient.invalidateQueries({ queryKey: keys.matches })
      void queryClient.invalidateQueries({ queryKey: keys.discover })
    },
  })

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-5 pb-6 sm:px-8 lg:pt-10">
      <header className="mb-8">
        <h1 className="font-display text-5xl leading-none">Likes you</h1>
        <p className="mt-2 text-sm text-muted">
          They already said yes. Like them back and it's an instant match.
        </p>
      </header>

      {likes.isPending ? (
        <div className="grid place-items-center py-24">
          <Spinner className="text-coral" />
        </div>
      ) : !likes.data?.length ? (
        <EmptyState
          icon={<Heart className="size-8" />}
          title="No new likes yet"
          action={
            <Link to="/app/discover" className="btn-primary">
              Keep discovering
            </Link>
          }
        >
          A great profile gets noticed. Add a prompt or two and a clear first photo.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          <AnimatePresence>
            {likes.data.map((like) => (
              <motion.li
                key={like.user.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="group relative aspect-[3/4] overflow-hidden rounded-[1.75rem] border border-line bg-surface shadow-card [container-type:inline-size]"
              >
                <button
                  type="button"
                  className="absolute inset-0 size-full"
                  onClick={() => setOpen(like)}
                  aria-label={`View ${like.user.name}'s profile`}
                >
                  <Photo
                    src={like.user.photos[0]}
                    name={like.user.name}
                    className="size-full transition duration-500 group-hover:scale-105"
                  />
                </button>
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent to-70%" />
                {like.action === 'super' && (
                  <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-sky px-2.5 py-1 text-[11px] font-bold text-ink">
                    <Star className="size-3 fill-current" /> Super like
                  </span>
                )}
                <span className="absolute top-3 right-3 rounded-full bg-ink/60 px-2 py-1 text-[11px] text-cream/80 backdrop-blur">
                  {shortAgo(like.created_at)}
                </span>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
                  <p className="truncate font-display text-3xl leading-none">
                    {like.user.name} <span className="text-cream/70">{like.user.age}</span>
                  </p>
                  <p className="mt-1 truncate text-xs text-cream/70">{like.user.job_title}</p>
                  <div className="pointer-events-auto mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => respond.mutate({ like, action: 'pass' })}
                      className="glass grid h-10 flex-1 place-items-center rounded-full border border-line-strong text-rose transition hover:scale-105"
                      aria-label={`Pass on ${like.user.name}`}
                    >
                      <X className="size-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => respond.mutate({ like, action: 'like' })}
                      className="grid h-10 flex-1 place-items-center rounded-full bg-gradient-brand text-ink shadow-glow transition hover:scale-105"
                      aria-label={`Like ${like.user.name} back`}
                    >
                      <Heart className="size-5 fill-current" />
                    </button>
                  </div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-40 grid place-items-end bg-ink/70 backdrop-blur-md sm:place-items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[2rem] border border-line-strong bg-surface sm:rounded-[2rem]"
              role="dialog"
              aria-label={`${open.user.name}'s profile`}
            >
              <div className="relative h-72 shrink-0 [container-type:inline-size]">
                <Photo src={open.user.photos[0]} name={open.user.name} className="size-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-surface to-transparent to-60%" />
              </div>
              <div className="-mt-12 overflow-y-auto px-7 pb-7">
                <ProfileDetails profile={open.user} />
                <div className="mt-7 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => respond.mutate({ like: open, action: 'pass' })}
                  >
                    <X className="size-4" /> Pass
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => respond.mutate({ like: open, action: 'like' })}
                  >
                    <Heart className="size-4 fill-current" /> Like back
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <MatchCelebration match={match} onClose={() => setMatch(null)} />
    </div>
  )
}
