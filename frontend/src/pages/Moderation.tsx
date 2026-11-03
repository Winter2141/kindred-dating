import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Ban, Check, Gavel, ShieldAlert, ShieldCheck, Undo2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Navigate } from 'react-router'
import { REPORT_REASONS } from '@/components/Safety'
import { Avatar, EmptyState, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { shortAgo } from '@/lib/time'
import type { AdminReport, ReportStatus } from '@/lib/types'
import { useToasts } from '@/store/live'

const TABS: { value: ReportStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'actioned', label: 'Actioned' },
  { value: 'dismissed', label: 'Dismissed' },
]

export function reasonLabel(reason: string): string {
  return REPORT_REASONS.find((r) => r.value === reason)?.label ?? reason
}

export function ModerationPage() {
  // Ask the server rather than trusting the profile saved in the browser, which may be stale.
  const me = useQuery({ queryKey: keys.me, queryFn: api.me })
  const isAdmin = me.data?.is_admin === true
  const [tab, setTab] = useState<ReportStatus>('open')
  const stats = useQuery({ queryKey: keys.moderationStats, queryFn: api.moderationStats, enabled: isAdmin })
  const reports = useQuery({ queryKey: keys.reports(tab), queryFn: () => api.reports(tab), enabled: isAdmin })

  if (me.isPending) {
    return (
      <div className="grid min-h-[60dvh] place-items-center">
        <Spinner className="text-coral" />
      </div>
    )
  }
  if (!isAdmin) return <Navigate to="/app/discover" replace />

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-5 pb-28 sm:px-8 lg:pt-10">
      <header className="mb-8">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-coral uppercase">
          <Gavel className="size-3.5" /> Moderation
        </p>
        <h1 className="mt-2 font-display text-5xl leading-none">Keep Kindred kind</h1>
        <p className="mt-2 text-sm text-muted">Review what members flagged. Bans take effect immediately.</p>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open reports" value={stats.data?.open_reports} accent />
        <Stat label="Resolved this week" value={stats.data?.resolved_this_week} />
        <Stat label="Banned accounts" value={stats.data?.banned_users} />
        <Stat label="Members" value={stats.data?.total_users} />
      </div>

      <div role="tablist" aria-label="Report status" className="mb-6 inline-flex rounded-full border border-line bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={clsx(
              'rounded-full px-4 py-2 text-sm font-semibold transition',
              tab === t.value ? 'bg-raised text-cream shadow-card' : 'text-muted hover:text-cream',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {reports.isPending ? (
        <div className="grid place-items-center py-20">
          <Spinner className="text-coral" />
        </div>
      ) : reports.data?.length ? (
        <ul className="space-y-4">
          <AnimatePresence initial={false}>
            {reports.data.map((report) => (
              <motion.li
                key={report.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 40 }}
              >
                <ReportCard report={report} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <EmptyState icon={<ShieldCheck className="size-9" />} title={tab === 'open' ? 'All clear' : 'Nothing here yet'}>
          {tab === 'open' ? 'No reports are waiting for review.' : 'Resolved reports will show up here.'}
        </EmptyState>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number | undefined; accent?: boolean }) {
  return (
    <div className="card p-5">
      <p className={clsx('font-display text-4xl leading-none', accent && value ? 'text-gradient' : '')}>
        {value ?? '–'}
      </p>
      <p className="mt-2 text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
    </div>
  )
}

export function ReportCard({ report }: { report: AdminReport }) {
  const queryClient = useQueryClient()
  const person = report.reported

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['reports'] })
    void queryClient.invalidateQueries({ queryKey: keys.moderationStats })
  }
  const resolve = useMutation({
    mutationFn: (action: 'dismiss' | 'ban') => api.resolveReport(report.id, action),
    onSuccess: (_, action) => {
      refresh()
      useToasts.getState().push({
        title: action === 'ban' ? `${person.name} was banned` : 'Report dismissed',
        image: action === 'ban' ? person.photos[0] : undefined,
      })
    },
    onError: (error) => useToasts.getState().push({ title: "Couldn't resolve", body: error.message }),
  })
  const unban = useMutation({
    mutationFn: () => api.unban(person.id),
    onSuccess: () => {
      refresh()
      useToasts.getState().push({ title: `${person.name} can sign in again` })
    },
  })

  return (
    <article className="card flex flex-col gap-5 p-5 sm:flex-row sm:p-6">
      <div className="flex min-w-0 flex-1 gap-4">
        <Avatar src={person.photos[0]} name={person.name} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">
              {person.name}, {person.age}
            </h2>
            <span className="chip border-danger/40 bg-danger/10 text-danger">
              <ShieldAlert className="size-3.5" /> {reasonLabel(report.reason)}
            </span>
            {person.open_reports > 1 && report.status === 'open' && (
              <span className="chip">{person.open_reports} open reports</span>
            )}
            {person.banned && <span className="chip border-line-strong text-muted">Banned</span>}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">{person.email}</p>
          {report.details && (
            <blockquote className="mt-3 border-l-2 border-coral/50 pl-3 text-[15px] leading-relaxed text-cream/90">
              {report.details}
            </blockquote>
          )}
          <p className="mt-3 flex items-center gap-2 text-xs text-faint">
            <Avatar src={report.reporter.photos[0]} name={report.reporter.name} size={18} />
            Reported by {report.reporter.name} · {shortAgo(report.created_at)} ago
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-start gap-2 sm:flex-col sm:items-stretch">
        {report.status === 'open' ? (
          <>
            <button
              type="button"
              className="btn-secondary py-2.5"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate('dismiss')}
            >
              <Check className="size-4" /> Dismiss
            </button>
            <button
              type="button"
              className="btn bg-danger py-2.5 font-bold text-ink hover:brightness-110"
              disabled={resolve.isPending}
              onClick={() => {
                if (window.confirm(`Ban ${person.name}? They'll be signed out and hidden from everyone.`)) {
                  resolve.mutate('ban')
                }
              }}
            >
              {resolve.isPending ? <Spinner className="size-4" /> : <Ban className="size-4" />} Ban
            </button>
          </>
        ) : person.banned ? (
          <button type="button" className="btn-ghost py-2.5" disabled={unban.isPending} onClick={() => unban.mutate()}>
            <Undo2 className="size-4" /> Unban
          </button>
        ) : null}
      </div>
    </article>
  )
}
