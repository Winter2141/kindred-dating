import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Ban,
  BadgeCheck,
  BadgeX,
  Check,
  ChevronLeft,
  ChevronRight,
  Gavel,
  History,
  Megaphone,
  Search,
  ShieldCheck,
  Undo2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { useDebounced } from '@/lib/search'
import { ago } from '@/lib/time'
import type { AdminUser, AuditEvent, MemberFilter } from '@/lib/types'
import { useToasts } from '@/store/live'
import { Segmented } from './ProfileFields'
import { VerifiedBadge } from './Verification'
import { Avatar, Dialog, EmptyState, Spinner } from './ui'

const PAGE = 20

const FILTERS: { value: MemberFilter; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'banned', label: 'Banned' },
  { value: 'verified', label: 'Verified' },
  { value: 'unverified', label: 'Not verified' },
  { value: 'admins', label: 'Moderators' },
]

/** Find any member, see their standing, and ban or unban them. */
export function MembersPanel() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MemberFilter>('all')
  const [page, setPage] = useState(0)
  const [banning, setBanning] = useState<AdminUser | null>(null)
  const settled = useDebounced(query.trim(), 300)
  const members = useQuery({
    queryKey: keys.members(settled, filter, page),
    queryFn: () => api.members({ q: settled, filter, limit: PAGE, offset: page * PAGE }),
    placeholderData: (previous) => previous,
  })
  const pages = Math.max(1, Math.ceil((members.data?.total ?? 0) / PAGE))

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative block lg:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
            placeholder="Name or email"
            aria-label="Search members"
            className="field rounded-full py-2.5 pl-11 text-sm"
          />
        </label>
        <Segmented
          label="Show"
          value={[filter]}
          onChange={([value]) => {
            setFilter(value)
            setPage(0)
          }}
          options={FILTERS}
        />
      </div>

      {members.isPending ? (
        <div className="grid place-items-center py-16">
          <Spinner className="text-coral" />
        </div>
      ) : !members.data?.items.length ? (
        <EmptyState icon={<Search className="size-8" />} title="No one matches">
          Try a different name or filter.
        </EmptyState>
      ) : (
        <>
          <p className="text-xs text-faint">
            {members.data.total} member{members.data.total === 1 ? '' : 's'}
          </p>
          <ul className={clsx('divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface', members.isFetching && 'opacity-70')}>
            {members.data.items.map((member) => (
              <li key={member.id}>
                <MemberRow member={member} onBan={() => setBanning(member)} />
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button type="button" className="btn-ghost py-2" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="size-4" /> Newer
              </button>
              <span className="text-muted">
                Page {page + 1} of {pages}
              </span>
              <button type="button" className="btn-ghost py-2" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                Older <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </>
      )}
      <BanDialog member={banning} onClose={() => setBanning(null)} />
    </div>
  )
}

function Tag({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'danger' | 'sky' | 'mint' }) {
  return (
    <span
      className={clsx(
        'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        tone === 'danger' && 'border-danger/40 bg-danger/10 text-danger',
        tone === 'sky' && 'border-sky/40 bg-sky/10 text-sky',
        tone === 'mint' && 'border-mint/40 bg-mint/10 text-mint',
        tone === 'plain' && 'border-line-strong text-muted',
      )}
    >
      {children}
    </span>
  )
}

function MemberRow({ member, onBan }: { member: AdminUser; onBan: () => void }) {
  const queryClient = useQueryClient()
  const unban = useMutation({
    mutationFn: () => api.unban(member.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members'] })
      void queryClient.invalidateQueries({ queryKey: keys.audit })
      useToasts.getState().push({ title: `${member.name} can sign in again` })
    },
  })
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar src={member.photos[0]} name={member.name} size={44} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 font-semibold">
            {member.name}, {member.age}
            {member.verified && <VerifiedBadge className="size-4" />}
            {member.is_admin && <Tag tone="mint">Moderator</Tag>}
            {member.banned && <Tag tone="danger">Banned</Tag>}
            {member.is_persona && <Tag>Demo persona</Tag>}
            {member.open_reports > 0 && <Tag tone="danger">{member.open_reports} open report{member.open_reports > 1 ? 's' : ''}</Tag>}
          </p>
          <p className="truncate text-sm text-muted">{member.email}</p>
          <p className="text-xs text-faint">
            Joined {ago(member.created_at)} · {member.matches} match{member.matches === 1 ? '' : 'es'}
            {!member.email_verified && ' · email not confirmed'}
          </p>
        </div>
      </div>
      {!member.is_admin &&
        (member.banned ? (
          <button type="button" className="btn-ghost py-2" disabled={unban.isPending} onClick={() => unban.mutate()}>
            <Undo2 className="size-4" /> Unban
          </button>
        ) : (
          <button type="button" className="btn-secondary py-2 text-danger" onClick={onBan}>
            <Ban className="size-4" /> Ban
          </button>
        ))}
    </div>
  )
}

function BanDialog({ member, onClose }: { member: AdminUser | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const ban = useMutation({
    mutationFn: () => api.banMember(member!.id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members'] })
      void queryClient.invalidateQueries({ queryKey: keys.audit })
      void queryClient.invalidateQueries({ queryKey: keys.moderationStats })
      useToasts.getState().push({ title: `${member?.name} was banned`, image: member?.photos[0] })
      setReason('')
      onClose()
    },
  })
  return (
    <Dialog open={member !== null} onClose={onClose} title={member ? `Ban ${member.name}?` : 'Ban'}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (reason.trim().length >= 3) ban.mutate()
        }}
      >
        <p className="text-sm text-muted">They'll be signed out everywhere, hidden from everyone and unable to sign in.</p>
        <label className="block">
          <span className="label">Reason (kept in the audit log)</span>
          <input
            className="field"
            value={reason}
            minLength={3}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Sending the same link to everyone"
            required
          />
        </label>
        {ban.isError && <p className="text-sm text-danger">{ban.error.message}</p>}
        <button type="submit" className="btn w-full bg-danger font-bold text-ink" disabled={reason.trim().length < 3 || ban.isPending}>
          {ban.isPending ? <Spinner className="size-4" /> : <Ban className="size-4" />} Ban
        </button>
      </form>
    </Dialog>
  )
}

const ACTIONS: Record<string, { icon: ReactNode; verb: string; untargeted?: boolean }> = {
  'announcement.posted': { icon: <Megaphone className="size-4 text-sky" />, verb: 'posted an announcement', untargeted: true },
  'announcement.ended': { icon: <Megaphone className="size-4 text-muted" />, verb: 'ended an announcement', untargeted: true },
  'report.dismissed': { icon: <Check className="size-4 text-muted" />, verb: 'dismissed a report about' },
  'user.banned': { icon: <Gavel className="size-4 text-danger" />, verb: 'banned' },
  'user.unbanned': { icon: <Undo2 className="size-4 text-mint" />, verb: 'unbanned' },
  'verification.approved': { icon: <BadgeCheck className="size-4 text-sky" />, verb: 'verified the photos of' },
  'verification.rejected': { icon: <BadgeX className="size-4 text-apricot" />, verb: 'turned down the selfie of' },
}

export function describeAudit(event: AuditEvent): string {
  const action = ACTIONS[event.action]
  const actor = event.actor_name ?? 'A former moderator'
  // Announcements are for everyone, so there's no one person they were done to.
  if (action?.untargeted) return `${actor} ${action.verb}`
  return `${actor} ${action?.verb ?? event.action} ${event.target?.name ?? 'a deleted account'}`
}

/** Everything moderators did, newest first. */
export function AuditPanel() {
  const log = useInfiniteQuery({
    queryKey: keys.audit,
    queryFn: ({ pageParam }) => api.audit(pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === 30 ? last[last.length - 1].id : undefined),
  })
  const events = log.data?.pages.flat() ?? []
  if (log.isPending) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner className="text-coral" />
      </div>
    )
  }
  if (events.length === 0) {
    return (
      <EmptyState icon={<History className="size-8" />} title="Nothing logged yet">
        Bans, unbans, dismissed reports and verification decisions show up here.
      </EmptyState>
    )
  }
  return (
    <div>
      <ol className="relative space-y-1 border-l border-line pl-6">
        {events.map((event) => (
          <li key={event.id} className="relative py-2.5">
            <span className="absolute top-3 -left-[2.05rem] grid size-7 place-items-center rounded-full border border-line bg-surface">
              {ACTIONS[event.action]?.icon ?? <ShieldCheck className="size-4" />}
            </span>
            <p className="text-[15px]">{describeAudit(event)}</p>
            {event.detail && <p className="mt-0.5 text-sm text-muted">“{event.detail}”</p>}
            <p className="mt-0.5 text-xs text-faint">{ago(event.created_at)}</p>
          </li>
        ))}
      </ol>
      {log.hasNextPage && (
        <button type="button" className="btn-ghost mt-4" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
          {log.isFetchingNextPage ? <Spinner className="size-4" /> : 'Load older'}
        </button>
      )}
    </div>
  )
}
