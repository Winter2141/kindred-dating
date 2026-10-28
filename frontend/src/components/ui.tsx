import clsx from 'clsx'
import { useId, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'

export function Logo({ className, mark = false }: { className?: string; mark?: boolean }) {
  // Gradient ids must be unique per instance: a hidden duplicate would blank out the others.
  const gradient = useId()
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 40 28" className="h-6 w-auto" aria-hidden>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff5c7a" />
            <stop offset="0.55" stopColor="#ff8a5b" />
            <stop offset="1" stopColor="#ffc36b" />
          </linearGradient>
        </defs>
        <circle cx="13" cy="14" r="10" fill="none" stroke={`url(#${gradient})`} strokeWidth="3.5" />
        <circle cx="27" cy="14" r="10" fill="none" stroke={`url(#${gradient})`} strokeWidth="3.5" />
      </svg>
      {!mark && (
        <span className="font-display text-[1.7rem] leading-none tracking-tight italic">kindred</span>
      )}
    </span>
  )
}

const GRADIENTS = [
  'from-rose to-apricot',
  'from-[#8b5cf6] to-rose',
  'from-sky to-mint',
  'from-coral to-[#f472b6]',
  'from-mint to-apricot',
]

/** An image that degrades to a warm gradient with an initial if it fails to load. */
export function Photo({
  src,
  name,
  className,
  eager,
}: {
  src?: string
  name: string
  className?: string
  eager?: boolean
}) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    const gradient = GRADIENTS[name.charCodeAt(0) % GRADIENTS.length]
    return (
      <div
        className={clsx(
          'grid place-items-center bg-gradient-to-br font-display text-ink/80 italic',
          gradient,
          className,
        )}
        aria-label={name}
        role="img"
      >
        <span className="text-[min(40cqw,5rem)] leading-none">{name.charAt(0)}</span>
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      loading={eager ? 'eager' : 'lazy'}
      draggable={false}
      onError={() => setBroken(true)}
      className={clsx('object-cover', className)}
    />
  )
}

export function Avatar({
  src,
  name,
  size = 48,
  online,
  ring,
}: {
  src?: string
  name: string
  size?: number
  online?: boolean
  ring?: boolean
}) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span
        className={clsx(
          'block size-full overflow-hidden rounded-full [container-type:inline-size]',
          ring && 'p-[2px] bg-gradient-brand',
        )}
      >
        <Photo
          src={src}
          name={name}
          className={clsx('size-full rounded-full', ring && 'border-2 border-ink')}
        />
      </span>
      {online && (
        <span
          className="absolute right-0 bottom-0 block size-[28%] max-h-3.5 max-w-3.5 min-h-2.5 min-w-2.5 rounded-full border-2 border-ink bg-mint animate-pulse-ring"
          aria-label="Online"
        />
      )}
    </span>
  )
}

export function useMeta() {
  return useQuery({ queryKey: keys.meta, queryFn: api.meta, staleTime: Infinity })
}

export function useInterestEmoji(): (name: string) => string {
  const { data } = useMeta()
  return (name) => data?.interests.find((i) => i.name === name)?.emoji ?? '✦'
}

export function InterestChip({
  name,
  shared,
  emoji,
}: {
  name: string
  shared?: boolean
  emoji: string
}) {
  return (
    <span className={clsx('chip', shared && 'chip-shared')}>
      <span aria-hidden>{emoji}</span>
      {name}
    </span>
  )
}

export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1', className)} aria-label="typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-current"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center">
      <div className="mb-6 grid size-20 place-items-center rounded-[1.75rem] border border-line bg-raised text-coral shadow-card">
        {icon}
      </div>
      <h2 className="font-display text-4xl leading-tight">{title}</h2>
      {children && <p className="mt-3 text-[15px] leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-7">{action}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-block size-5 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
      aria-label="Loading"
    />
  )
}

export function CompatibilityRing({ value, size = 52 }: { value: number; size?: number }) {
  const gradient = useId()
  const radius = 20
  const circumference = 2 * Math.PI * radius
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff5c7a" />
            <stop offset="1" stopColor="#ffc36b" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r={radius} fill="rgb(18 13 12 / .55)" stroke="rgb(255 255 255 / .15)" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke={`url(#${gradient})`}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
        />
      </svg>
      <span className="relative text-[13px] font-bold">{value}%</span>
    </span>
  )
}
