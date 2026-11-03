import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { BarChart3, Heart, MessageCircle, Reply, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { EmptyState, Spinner, useInterestEmoji } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { ActivityDay, Insights } from '@/lib/types'

/** Series colours, validated for the dark card surface (lightness band, CVD and contrast). */
export const SERIES = {
  likes: { label: 'Likes received', color: '#d13760' },
  matches: { label: 'Matches', color: '#c68627' },
  messages: { label: 'Messages', color: '#3786c3' },
} as const
type SeriesKey = keyof typeof SERIES

const RANGES = [7, 14, 30] as const

export function percent(value: number | null): string {
  return value === null ? '–' : `${Math.round(value * 100)}%`
}

export function replySpeed(minutes: number | null): string {
  if (minutes === null) return 'No replies yet'
  if (minutes < 1) return 'Usually replies right away'
  if (minutes < 60) return `Usually within ${minutes} min`
  return `Usually within ${Math.round(minutes / 60)} h`
}

export function shortDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function InsightsPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(14)
  const insights = useQuery({ queryKey: keys.insights(days), queryFn: () => api.insights(days) })

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-5 pb-28 sm:px-8 lg:pt-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl leading-none">Insights</h1>
          <p className="mt-2 text-sm text-muted">How your swiping and chatting have gone lately.</p>
        </div>
        <div role="group" aria-label="Time range" className="inline-flex rounded-full border border-line bg-surface p-1">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={days === range}
              onClick={() => setDays(range)}
              className={clsx(
                'rounded-full px-4 py-1.5 text-sm font-semibold transition',
                days === range ? 'bg-raised text-cream shadow-card' : 'text-muted hover:text-cream',
              )}
            >
              {range} days
            </button>
          ))}
        </div>
      </header>

      {insights.isPending ? (
        <div className="grid place-items-center py-24">
          <Spinner className="text-coral" />
        </div>
      ) : insights.data ? (
        <InsightsView data={insights.data} />
      ) : (
        <EmptyState icon={<BarChart3 className="size-8" />} title="No insights yet">
          Swipe and chat for a few days and your stats will show up here.
        </EmptyState>
      )}
    </div>
  )
}

export function InsightsView({ data }: { data: Insights }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Heart className="size-4" />} label="Likes received" value={data.likes_received}>
          {data.super_likes_received} super like{data.super_likes_received === 1 ? '' : 's'}
        </Tile>
        <Tile icon={<Sparkles className="size-4" />} label="Matches" value={data.matches}>
          {percent(data.match_rate)} of your {data.likes_sent} likes
        </Tile>
        <Tile icon={<MessageCircle className="size-4" />} label="Messages" value={data.messages_sent + data.messages_received}>
          {data.messages_sent} sent · {data.messages_received} received
        </Tile>
        <Tile icon={<Reply className="size-4" />} label="Reply rate" value={percent(data.reply_rate)}>
          {replySpeed(data.median_reply_minutes)}
        </Tile>
      </div>

      <section className="card p-5 sm:p-6">
        <h2 className="font-display text-3xl">Day by day</h2>
        <p className="mt-1 text-sm text-muted">Each measure on its own scale, so a busy chat day doesn't flatten the rest.</p>
        <div className="mt-6 grid gap-8 lg:grid-cols-3">
          {(Object.keys(SERIES) as SeriesKey[]).map((key) => (
            <DailyBars key={key} series={key} days={data.activity} />
          ))}
        </div>
        <ActivityTable days={data.activity} />
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="font-display text-3xl">What people who like you are into</h2>
        <p className="mt-1 text-sm text-muted">The most common interests among everyone who liked you in this period.</p>
        <InterestBars items={data.liked_by_interests} />
      </section>
    </div>
  )
}

function Tile({ icon, label, value, children }: { icon: ReactNode; label: string; value: number | string; children: ReactNode }) {
  return (
    <div className="card p-5">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        <span className="text-coral">{icon}</span> {label}
      </p>
      <p className="mt-3 font-display text-5xl leading-none">{value}</p>
      <p className="mt-2 text-xs text-muted">{children}</p>
    </div>
  )
}

const valueOf = (day: ActivityDay, series: SeriesKey) =>
  series === 'likes' ? day.likes_received : series === 'matches' ? day.matches : day.messages

/** One measure per chart: thin bars on a shared baseline, hover or focus for the exact value. */
export function DailyBars({ series, days }: { series: SeriesKey; days: ActivityDay[] }) {
  const [active, setActive] = useState<number | null>(null)
  const { label, color } = SERIES[series]
  const values = days.map((d) => valueOf(d, series))
  const max = Math.max(1, ...values)
  const total = values.reduce((a, b) => a + b, 0)
  const shown = active === null ? null : days[active]

  return (
    <figure>
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-muted">{total} total</span>
      </figcaption>
      <div className="relative mt-3">
        <span className="absolute -top-1 right-0 text-[11px] text-faint">{max}</span>
        <div className="flex h-32 items-end gap-[2px] border-b border-line pt-4" onMouseLeave={() => setActive(null)}>
          {days.map((day, index) => {
            const value = values[index]
            return (
              <button
                key={day.day}
                type="button"
                className="group relative flex h-full flex-1 items-end focus:outline-none"
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                aria-label={`${shortDay(day.day)}: ${value} ${label.toLowerCase()}`}
              >
                <span
                  className={clsx(
                    'block w-full rounded-t-[4px] transition-opacity',
                    active !== null && active !== index && 'opacity-40',
                  )}
                  style={{ height: value ? `${Math.max(4, (value / max) * 100)}%` : 0, background: color }}
                />
              </button>
            )
          })}
        </div>
        {shown && (
          <div
            role="tooltip"
            className="pointer-events-none absolute -top-9 z-10 -translate-x-1/2 rounded-lg border border-line-strong bg-raised px-2.5 py-1 text-xs whitespace-nowrap shadow-card"
            style={{ left: `${((active! + 0.5) / days.length) * 100}%` }}
          >
            <span className="text-muted">{shortDay(shown.day)}</span>{' '}
            <span className="font-semibold text-cream">{valueOf(shown, series)}</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-faint">
        <span>{days[0] && shortDay(days[0].day)}</span>
        <span>{days.length > 0 && shortDay(days[days.length - 1].day)}</span>
      </div>
    </figure>
  )
}

function ActivityTable({ days }: { days: ActivityDay[] }) {
  return (
    <details className="mt-6 text-sm">
      <summary className="cursor-pointer text-muted hover:text-cream">View as table</summary>
      <table className="mt-3 w-full text-left">
        <thead className="text-xs text-muted uppercase">
          <tr>
            <th className="py-1.5 font-semibold">Day</th>
            <th className="py-1.5 text-right font-semibold">Likes</th>
            <th className="py-1.5 text-right font-semibold">Matches</th>
            <th className="py-1.5 text-right font-semibold">Messages</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {days.map((day) => (
            <tr key={day.day}>
              <td className="py-1.5">{shortDay(day.day)}</td>
              <td className="py-1.5 text-right">{day.likes_received}</td>
              <td className="py-1.5 text-right">{day.matches}</td>
              <td className="py-1.5 text-right">{day.messages}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function InterestBars({ items }: { items: Insights['liked_by_interests'] }) {
  const emoji = useInterestEmoji()
  if (items.length === 0) {
    return <p className="mt-5 text-sm text-faint">No likes in this period yet.</p>
  }
  const max = Math.max(...items.map((i) => i.count))
  return (
    <ul className="mt-5 space-y-3">
      {items.map((item) => (
        <li key={item.interest} className="grid grid-cols-[8.5rem_1fr_2rem] items-center gap-3 text-sm">
          <span className="truncate">
            {emoji(item.interest)} {item.interest}
          </span>
          <span className="h-3 rounded-r-[4px]" style={{ width: `${(item.count / max) * 100}%`, background: SERIES.likes.color }} />
          <span className="text-right text-muted">{item.count}</span>
        </li>
      ))}
    </ul>
  )
}
