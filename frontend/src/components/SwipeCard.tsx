import clsx from 'clsx'
import { Briefcase, Info, MapPin, Star } from 'lucide-react'
import { motion, useMotionValue, useTransform, type PanInfo } from 'motion/react'
import type { Candidate, SwipeAction } from '@/lib/types'
import { lastSeen } from '@/lib/time'
import { CompatibilityRing, InterestChip, Photo, useInterestEmoji } from './ui'

const SWIPE_DISTANCE = 120
const SWIPE_VELOCITY = 600

export const exitFor = (action: SwipeAction) => {
  if (action === 'super') return { y: -900, x: 0, rotate: 0, opacity: 0 }
  const direction = action === 'like' ? 1 : -1
  return { x: direction * 700, rotate: direction * 24, opacity: 0 }
}

export function SwipeCard({
  candidate,
  depth,
  onSwipe,
  onInfo,
}: {
  candidate: Candidate
  /** 0 is the top card; 1 and 2 peek out behind it. */
  depth: number
  onSwipe: (action: SwipeAction) => void
  onInfo: () => void
}) {
  const emoji = useInterestEmoji()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotate = useTransform(x, [-300, 300], [-16, 16])
  const likeOpacity = useTransform(x, [30, 130], [0, 1])
  const nopeOpacity = useTransform(x, [-130, -30], [1, 0])
  const superOpacity = useTransform(y, [-140, -40], [1, 0])
  const isTop = depth === 0

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info
    if (offset.y < -SWIPE_DISTANCE && Math.abs(offset.x) < SWIPE_DISTANCE) onSwipe('super')
    else if (offset.x > SWIPE_DISTANCE || velocity.x > SWIPE_VELOCITY) onSwipe('like')
    else if (offset.x < -SWIPE_DISTANCE || velocity.x < -SWIPE_VELOCITY) onSwipe('pass')
  }

  const highlights = [
    ...candidate.shared_interests,
    ...candidate.interests.filter((i) => !candidate.shared_interests.includes(i)),
  ].slice(0, 3)

  return (
    <motion.article
      className={clsx(
        'absolute inset-0 overflow-hidden rounded-[2rem] bg-surface shadow-card [container-type:inline-size]',
        isTop ? 'cursor-grab touch-none active:cursor-grabbing' : 'pointer-events-none',
      )}
      style={{ x, y, rotate, zIndex: 10 - depth }}
      initial={{ scale: 0.92, y: 30, opacity: 0 }}
      animate={{ scale: 1 - depth * 0.045, y: depth * 18, opacity: depth > 2 ? 0 : 1 }}
      variants={{
        leave: (custom: SwipeAction) => ({ ...exitFor(custom), transition: { duration: 0.38 } }),
      }}
      exit="leave"
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      drag={isTop}
      dragSnapToOrigin
      dragElastic={0.9}
      onDragEnd={handleDragEnd}
      aria-label={`${candidate.name}, ${candidate.age}`}
    >
      <Photo
        src={candidate.photos[0]}
        name={candidate.name}
        eager={depth < 2}
        className="absolute inset-0 size-full"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/25 to-transparent to-55%" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink/50 to-transparent" />

      <div className="absolute top-4 right-4 left-4 flex items-start justify-between">
        {candidate.super_liked_you ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky px-3 py-1.5 text-xs font-bold text-ink shadow-lg">
            <Star className="size-3.5 fill-current" /> Super liked you
          </span>
        ) : (
          <span />
        )}
        <span title="Compatibility">
          <CompatibilityRing value={candidate.compatibility} />
        </span>
      </div>

      {isTop && (
        <>
          <motion.span
            style={{ opacity: likeOpacity }}
            className="absolute top-24 left-6 -rotate-12 rounded-xl border-4 border-mint px-3 py-1 text-3xl font-extrabold tracking-widest text-mint"
          >
            LIKE
          </motion.span>
          <motion.span
            style={{ opacity: nopeOpacity }}
            className="absolute top-24 right-6 rotate-12 rounded-xl border-4 border-rose px-3 py-1 text-3xl font-extrabold tracking-widest text-rose"
          >
            NOPE
          </motion.span>
          <motion.span
            style={{ opacity: superOpacity }}
            className="absolute bottom-48 left-1/2 -translate-x-1/2 rounded-xl border-4 border-sky px-3 py-1 text-3xl font-extrabold tracking-widest text-sky"
          >
            SUPER
          </motion.span>
        </>
      )}

      <div className="absolute inset-x-0 bottom-0 p-6">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-5xl leading-none drop-shadow-lg">
              {candidate.name} <span className="text-cream/75">{candidate.age}</span>
            </h2>
            <div className="mt-3 space-y-1.5 text-sm text-cream/85">
              {candidate.job_title && (
                <p className="flex items-center gap-2 truncate">
                  <Briefcase className="size-4 shrink-0" /> {candidate.job_title}
                </p>
              )}
              <p className="flex items-center gap-2 truncate">
                <MapPin className="size-4 shrink-0" /> {candidate.city || 'Nearby'}
                <span className="text-cream/40">·</span>
                <span className={clsx(candidate.is_online && 'text-mint')}>
                  {lastSeen(candidate.last_active_at, candidate.is_online)}
                </span>
              </p>
            </div>
          </div>
          {isTop && (
            <button
              type="button"
              onClick={onInfo}
              onPointerDown={(e) => e.stopPropagation()}
              className="glass grid size-11 shrink-0 place-items-center rounded-full border border-line-strong transition hover:scale-105"
              aria-label={`More about ${candidate.name}`}
            >
              <Info className="size-5" />
            </button>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {highlights.map((interest) => (
            <InterestChip
              key={interest}
              name={interest}
              emoji={emoji(interest)}
              shared={candidate.shared_interests.includes(interest)}
            />
          ))}
        </div>
      </div>
    </motion.article>
  )
}
