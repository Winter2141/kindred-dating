import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { CircleCheck, Lightbulb } from 'lucide-react'
import { motion } from 'motion/react'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { ProfileStrength as Strength } from '@/lib/types'

export function strengthLabel(score: number): string {
  if (score >= 90) return 'Standout'
  if (score >= 70) return 'Strong'
  if (score >= 40) return 'Getting there'
  return 'Just started'
}

export function ProfileStrength() {
  const strength = useQuery({ queryKey: keys.strength, queryFn: api.strength })
  if (!strength.data) return null
  return <StrengthCard strength={strength.data} />
}

export function StrengthCard({ strength }: { strength: Strength }) {
  const { score, tips } = strength
  return (
    <section className="card mt-6 p-5" aria-label="Profile strength">
      <div className="flex items-baseline justify-between">
        <p className="label mb-0">Profile strength</p>
        <p className="text-sm font-semibold">
          <span className={clsx(score >= 70 ? 'text-mint' : 'text-apricot')}>{strengthLabel(score)}</span>
          <span className="text-faint"> · {score}%</span>
        </p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-raised"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className="h-full rounded-full bg-gradient-brand"
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ type: 'spring', damping: 24, stiffness: 120 }}
        />
      </div>
      {tips.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {tips.slice(0, 3).map((tip) => (
            <li key={tip.key} className="flex items-start gap-2.5 text-sm text-cream/85">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-apricot" />
              <span className="flex-1">{tip.text}</span>
              <span className="shrink-0 text-xs font-semibold text-coral">+{tip.points}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-sm text-mint">
          <CircleCheck className="size-4" /> Your profile has everything it needs.
        </p>
      )}
    </section>
  )
}
