import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Clock, Hourglass, Inbox, UserPlus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { REPORT_REASONS } from '@/components/Safety'
import { Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { TrendDay, Trends } from '@/lib/types'

/**
 * Two colours from the Insights palette, checked as a pair with the dataviz validator on
 * both the dark (#1c1514) and light (#ffffff) card surfaces: lightness, chroma, colour-blind
 * separation and contrast all pass. A third hue is used alone, so it never sits beside them.
 */
const FILED = { label: 'Filed', color: '#d13760' }
const RESOLVED = { label: 'Resolved', color: '#3786c3' }
const MEMBERS = { label: 'New members', color: '#c68627' }

const RANGES = [7, 14, 30] as const

interface Series {
  label: string
  color: string
  value: (day: TrendDay) => number
}

/** "Under an hour", "5 h", "2.5 days"; a dash before there's anything to measure. */
export function waitLabel(hours: number | null): string {
  if (hours === null) return '–'
  if (hours < 1) return 'Under an hour'
  if (hours < 48) return `${Math.round(hours)} h`
  return `${(hours / 24).toFixed(1)} days`
}

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function reasonName(reason: string): string {
  return REPORT_REASONS.find((r) => r.value === reason)?.label ?? reason
}

export function ModerationTrends() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(14)
  const trends = useQuery({ queryKey: keys.moderationTrends(days), queryFn: () => api.moderationTrends(days) })

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">How quickly reports get handled, and what they're about.</p>
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
      </div>
      {trends.isPending ? (
        <div className="grid place-items-center py-20">
          <Spinner className="text-coral" />
        </div>
      ) : trends.isError ? (
        <p className="text-sm text-danger">Couldn't load trends. {trends.error.message}</p>
      ) : (
        <TrendsView data={trends.data} />
      )}
    </div>
  )
}

export function TrendsView({ data }: { data: Trends }) {
  const backlog = data.reports_filed - data.reports_resolved
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Inbox className="size-4" />} label="Reports filed" value={data.reports_filed}>
          {data.reports_resolved} resolved
          {backlog > 0 ? ` · queue grew by ${backlog}` : backlog < 0 ? ` · queue shrank by ${-backlog}` : ''}
        </Tile>
        <Tile icon={<Clock className="size-4" />} label="Time to resolve" value={waitLabel(data.median_hours_to_resolve)}>
          Median, for reports resolved in this period
        </Tile>
        <Tile icon={<Hourglass className="size-4" />} label="Oldest waiting" value={waitLabel(data.oldest_open_hours)}>
          {data.oldest_open_hours === null ? 'Nothing open right now' : 'The report open longest, right now'}
        </Tile>
        <Tile icon={<UserPlus className="size-4" />} label="New members" value={data.new_members}>
          Signed up in this period
        </Tile>
      </div>

      <section className="card p-5 sm:p-6">
        <h2 className="font-display text-3xl">Reports, day by day</h2>
        <p className="mt-1 text-sm text-muted">Filed on the day they came in; resolved on the day a moderator acted.</p>
        <DayBars
          days={data.activity}
          series={[
            { ...FILED, value: (d) => d.reports_filed },
            { ...RESOLVED, value: (d) => d.reports_resolved },
          ]}
        />
        <TrendsTable days={data.activity} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5 sm:p-6">
          <h2 className="font-display text-3xl">New members</h2>
          <DayBars days={data.activity} series={[{ ...MEMBERS, value: (d) => d.new_members }]} />
        </section>
        <section className="card p-5 sm:p-6">
          <h2 className="font-display text-3xl">What people report</h2>
          <ReasonBars items={data.by_reason} />
        </section>
      </div>
    </div>
  )
}

function Tile({ icon, label, value, children }: { icon: ReactNode; label: string; value: number | string; children: ReactNode }) {
  return (
    <div className="card p-5">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        <span className="text-coral">{icon}</span> {label}
      </p>
      <p className="mt-3 font-display text-4xl leading-none sm:text-5xl">{value}</p>
      <p className="mt-2 text-xs text-muted">{children}</p>
    </div>
  )
}

/** One or two measures with the same unit on one baseline; hover or focus a day for its numbers. */
export function DayBars({ days, series }: { days: TrendDay[]; series: Series[] }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...days.flatMap((day) => series.map((s) => s.value(day))))
  const shown = active === null ? null : days[active]
  const empty = days.every((day) => series.every((s) => s.value(day) === 0))

  return (
    <figure className="mt-6">
      {series.length > 1 ? (
        <figcaption className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Legend">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-2">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label} <span className="text-muted">{days.reduce((sum, d) => sum + s.value(d), 0)}</span>
            </span>
          ))}
        </figcaption>
      ) : (
        <figcaption className="sr-only">{series[0]?.label} by day</figcaption>
      )}
      <div className="relative">
        {empty ? (
          <p className="absolute inset-0 grid place-items-center text-sm text-faint">Nothing in this period</p>
        ) : (
          <span className="absolute -top-1 right-0 text-[11px] text-faint">{max}</span>
        )}
        <div className="flex h-36 items-end gap-1 border-b border-line pt-4" onMouseLeave={() => setActive(null)}>
          {days.map((day, index) => (
            <button
              key={day.day}
              type="button"
              className="flex h-full flex-1 items-end justify-center gap-[2px] focus:outline-none"
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              aria-label={`${shortDay(day.day)}: ${series.map((s) => `${s.value(day)} ${s.label.toLowerCase()}`).join(', ')}`}
            >
              {series.map((s) => {
                const value = s.value(day)
                return (
                  <span
                    key={s.label}
                    className={clsx(
                      'block w-full max-w-3 rounded-t-[4px] transition-opacity',
                      active !== null && active !== index && 'opacity-40',
                    )}
                    style={{ height: value ? `${Math.max(4, (value / max) * 100)}%` : 0, background: s.color }}
                  />
                )
              })}
            </button>
          ))}
        </div>
        {shown && (
          <div
            role="tooltip"
            className="pointer-events-none absolute -top-10 z-10 -translate-x-1/2 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-xs whitespace-nowrap shadow-card"
            style={{ left: `${Math.min(88, Math.max(12, ((active! + 0.5) / days.length) * 100))}%` }}
          >
            <span className="text-muted">{shortDay(shown.day)}</span>
            {series.map((s) => (
              <span key={s.label} className="ml-2 inline-flex items-center gap-1">
                <span className="size-2 rounded-sm" style={{ background: s.color }} />
                <span className="font-semibold text-cream">{s.value(shown)}</span>
              </span>
            ))}
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

function ReasonBars({ items }: { items: Trends['by_reason'] }) {
  if (items.length === 0) return <p className="mt-5 text-sm text-faint">No reports in this period.</p>
  const max = Math.max(...items.map((i) => i.count))
  return (
    <ul className="mt-5 space-y-3" aria-label="Reports by reason">
      {items.map((item) => (
        <li key={item.reason} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-3 text-sm">
          <span className="truncate">{reasonName(item.reason)}</span>
          <span
            className="h-3 rounded-r-[4px]"
            style={{ width: `${(item.count / max) * 100}%`, background: FILED.color }}
          />
          <span className="text-right text-muted">{item.count}</span>
        </li>
      ))}
    </ul>
  )
}

function TrendsTable({ days }: { days: TrendDay[] }) {
  return (
    <details className="mt-6 text-sm">
      <summary className="cursor-pointer text-muted hover:text-cream">View as table</summary>
      <table className="mt-3 w-full text-left">
        <thead className="text-xs text-muted uppercase">
          <tr>
            <th className="py-1.5 font-semibold">Day</th>
            <th className="py-1.5 text-right font-semibold">Filed</th>
            <th className="py-1.5 text-right font-semibold">Resolved</th>
            <th className="py-1.5 text-right font-semibold">New members</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {days.map((day) => (
            <tr key={day.day}>
              <td className="py-1.5">{shortDay(day.day)}</td>
              <td className="py-1.5 text-right">{day.reports_filed}</td>
              <td className="py-1.5 text-right">{day.reports_resolved}</td>
              <td className="py-1.5 text-right">{day.new_members}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
