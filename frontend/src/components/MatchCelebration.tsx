import { Heart, MessageCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import type { Match } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { Photo } from './ui'

const SPARKS = Array.from({ length: 18 }, (_, i) => ({
  angle: (i / 18) * Math.PI * 2,
  distance: 140 + (i % 3) * 40,
  delay: (i % 6) * 0.04,
  size: 6 + (i % 4) * 3,
}))

export function MatchCelebration({ match, onClose }: { match: Match | null; onClose: () => void }) {
  const me = useAuth((s) => s.user)
  const navigate = useNavigate()

  useEffect(() => {
    if (!match) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [match, onClose])

  return (
    <AnimatePresence>
      {match && me && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-ink/85 px-6 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={`You matched with ${match.user.name}`}
        >
          <div className="pointer-events-none absolute top-1/2 left-1/2 size-[36rem] -translate-1/2 rounded-full bg-rose/25 blur-[120px]" />
          <div className="relative flex w-full max-w-md flex-col items-center text-center">
            <div className="relative mb-10 flex h-52 items-center justify-center">
              {SPARKS.map((spark, i) => (
                <motion.span
                  key={i}
                  className="absolute rounded-full bg-gradient-brand"
                  style={{ width: spark.size, height: spark.size }}
                  initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                  animate={{
                    x: Math.cos(spark.angle) * spark.distance,
                    y: Math.sin(spark.angle) * spark.distance,
                    opacity: [0, 1, 0],
                    scale: [0, 1.2, 0.6],
                  }}
                  transition={{ duration: 1.4, delay: 0.35 + spark.delay, ease: 'easeOut' }}
                />
              ))}
              <motion.div
                initial={{ x: -120, rotate: -20, opacity: 0 }}
                animate={{ x: -52, rotate: -8, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 180, damping: 16, delay: 0.1 }}
                className="absolute h-48 w-36 overflow-hidden rounded-3xl border-4 border-ink shadow-card [container-type:inline-size]"
              >
                <Photo src={me.photos[0]} name={me.name} className="size-full" />
              </motion.div>
              <motion.div
                initial={{ x: 120, rotate: 20, opacity: 0 }}
                animate={{ x: 52, rotate: 8, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 180, damping: 16, delay: 0.1 }}
                className="absolute h-48 w-36 overflow-hidden rounded-3xl border-4 border-ink shadow-card [container-type:inline-size]"
              >
                <Photo src={match.user.photos[0]} name={match.user.name} className="size-full" />
              </motion.div>
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.3, 1] }}
                transition={{ delay: 0.45, duration: 0.5 }}
                className="absolute bottom-0 grid size-16 place-items-center rounded-full bg-gradient-brand shadow-glow"
              >
                <Heart className="size-7 fill-ink text-ink" />
              </motion.span>
            </div>

            <motion.h2
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="font-display text-7xl leading-none italic"
            >
              <span className="text-gradient pr-2">It's a match</span>
            </motion.h2>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-4 text-[15px] text-muted"
            >
              You and {match.user.name} liked each other. Don't leave them waiting.
            </motion.p>
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-9 flex w-full flex-col gap-3"
            >
              <button
                type="button"
                className="btn-primary py-4 text-base"
                onClick={() => {
                  onClose()
                  navigate(`/app/matches/${match.id}`)
                }}
              >
                <MessageCircle className="size-5" /> Send a message
              </button>
              <button type="button" className="btn-ghost" onClick={onClose}>
                Keep swiping
              </button>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
