import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Archive, BellOff, CalendarCheck, ChevronDown, MessageCircleHeart, Pin, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router'
import { ChatMenu, muteLabel } from '@/components/ChatMenu'
import { MIN_SEARCH_LENGTH, MessageResults } from '@/components/ChatSearch'
import { VerifiedBadge } from '@/components/Verification'
import { Avatar, EmptyState, Spinner, TypingDots } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { formatDateTime } from '@/lib/dates'
import type { Match } from '@/lib/types'
import { shortAgo } from '@/lib/time'
import { previewText } from '@/lib/photos'
import { useAuth } from '@/store/auth'
import { useLive } from '@/store/live'

export function MatchesLayout() {
  const { matchId } = useParams()
  return (
    <div className="flex h-[calc(100dvh-8.5rem)] lg:h-dvh">
      <div
        className={clsx(
          'w-full shrink-0 border-line lg:block lg:w-[360px] lg:border-r',
          matchId && 'hidden',
        )}
      >
        <MatchList />
      </div>
      <div className={clsx('min-w-0 flex-1', !matchId && 'hidden lg:block')}>
        <Outlet />
      </div>
    </div>
  )
}

export function NoChatSelected() {
  return (
    <div className="grid h-full place-items-center">
      <EmptyState icon={<MessageCircleHeart className="size-8" />} title="Pick a conversation">
        Your matches live on the left. Messages arrive here in real time, with typing indicators
        and read receipts.
      </EmptyState>
    </div>
  )
}

function MatchList() {
  const me = useAuth((s) => s.user)
  const matches = useQuery({ queryKey: keys.matches, queryFn: api.matches })
  const online = useLive((s) => s.online)
  const typing = useLive((s) => s.typing)
  const [filter, setFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const upcoming = useQuery({ queryKey: keys.upcomingDates, queryFn: api.upcomingDates })

  if (matches.isPending) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="text-coral" />
      </div>
    )
  }
  const all = matches.data ?? []
  const searching = filter.trim().length >= MIN_SEARCH_LENGTH
  const fresh = all.filter((m) => !m.last_message)
  const named = all
    .filter((m) => m.last_message)
    .filter((m) => m.user.name.toLowerCase().includes(filter.trim().toLowerCase()))
  // Searching looks through archived chats too.
  const conversations = filter.trim() ? named : named.filter((m) => !m.archived)
  const archived = named.filter((m) => m.archived)
  const archivedUnread = archived.filter((m) => m.unread_count > 0).length

  if (all.length === 0) {
    return (
      <EmptyState
        icon={<MessageCircleHeart className="size-8" />}
        title="No matches yet"
        action={
          <Link to="/app/discover" className="btn-primary">
            Start swiping
          </Link>
        }
      >
        When someone likes you back, they'll show up here.
      </EmptyState>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 lg:pt-10">
        <h1 className="font-display text-5xl leading-none">Chats</h1>
      </div>

      {upcoming.data && upcoming.data.length > 0 && (
        <section className="mt-6 px-3">
          <p className="label px-2">Upcoming dates</p>
          <ul className="space-y-1">
            {upcoming.data.map((date) => (
              <li key={date.id}>
                <Link
                  to={`/app/matches/${date.match_id}`}
                  className="flex items-center gap-3 rounded-2xl border border-mint/20 bg-mint/5 px-3 py-2.5 transition hover:bg-mint/10"
                >
                  <Avatar src={date.with_user.photos[0]} name={date.with_user.name} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {date.with_user.name} · {date.place}
                    </span>
                    <span className="block text-xs text-mint">{formatDateTime(date.starts_at)}</span>
                  </span>
                  <CalendarCheck className="size-4 shrink-0 text-mint" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fresh.length > 0 && (
        <section className="mt-6">
          <p className="label px-5">New matches</p>
          <div className="flex gap-4 overflow-x-auto px-5 pb-2 scrollbar-none">
            {fresh.map((match) => (
              <Link
                key={match.id}
                to={`/app/matches/${match.id}`}
                className="flex w-[72px] shrink-0 flex-col items-center gap-2 text-center"
              >
                <Avatar
                  src={match.user.photos[0]}
                  name={match.user.name}
                  size={68}
                  ring
                  online={online[match.user.id] ?? match.user.is_online}
                />
                <span className="w-full truncate text-xs font-semibold">{match.user.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-5 px-5">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            placeholder="Search people and messages"
            aria-label="Search people and messages"
            data-shortcut="search"
            className="field rounded-full py-2.5 pl-11 text-sm"
          />
        </label>
      </div>

      <ul className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {conversations.map((match) => (
          <li key={match.id}>
            <ConversationRow
              match={match}
              meId={me?.id}
              online={online[match.user.id] ?? match.user.is_online}
              typing={typing[match.id] !== undefined}
            />
          </li>
        ))}
        {!filter.trim() && archived.length > 0 && (
          <li className="pt-2">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-muted transition hover:bg-raised/50 hover:text-cream"
            >
              <Archive className="size-4" />
              Archived ({archived.length})
              {archivedUnread > 0 && <span className="size-2 rounded-full bg-coral" aria-label="Unread messages" />}
              <ChevronDown className={clsx('ml-auto size-4 transition', showArchived && 'rotate-180')} />
            </button>
          </li>
        )}
        {showArchived &&
          !filter.trim() &&
          archived.map((match) => (
            <li key={match.id}>
              <ConversationRow
                match={match}
                meId={me?.id}
                online={online[match.user.id] ?? match.user.is_online}
                typing={typing[match.id] !== undefined}
              />
            </li>
          ))}
        {conversations.length === 0 && archived.length === 0 && !searching && (
          <li className="px-3 py-8 text-center text-sm text-muted">
            {filter ? 'No conversations match that name.' : 'Say hi to a new match to start chatting.'}
          </li>
        )}
        {searching && (
          <li>
            <MessageResults query={filter} meId={me?.id} />
          </li>
        )}
      </ul>
    </div>
  )
}

function ConversationRow({
  match,
  meId,
  online,
  typing,
}: {
  match: Match
  meId?: number
  online: boolean
  typing: boolean
}) {
  const last = match.last_message
  const unread = match.unread_count > 0
  return (
    <div className="group relative">
      <NavLink
        to={`/app/matches/${match.id}`}
        className={({ isActive }) =>
          clsx(
            'flex items-center gap-3.5 rounded-2xl py-3 pr-12 pl-3 transition lg:pr-3',
            isActive ? 'bg-raised' : 'hover:bg-raised/50',
          )
        }
      >
        <Avatar src={match.user.photos[0]} name={match.user.name} size={52} online={online} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={clsx('flex min-w-0 items-center gap-1.5 text-[15px]', unread ? 'font-bold' : 'font-semibold')}>
              <span className="truncate">{match.user.name}</span>
              {match.user.verified && <VerifiedBadge className="size-3.5" />}
              {match.pinned && <Pin className="size-3.5 shrink-0 text-apricot" aria-label="Pinned" />}
              {match.muted && (
                <BellOff className="size-3.5 shrink-0 text-faint" aria-label={muteLabel(match.muted_until)} />
              )}
            </p>
            {last && (
              <span className={clsx('shrink-0 text-xs', unread ? 'text-coral' : 'text-faint')}>
                {shortAgo(last.created_at)}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            {typing ? (
              <span className="flex items-center gap-2 text-sm text-coral">
                <TypingDots /> typing
              </span>
            ) : (
              <p className={clsx('truncate text-sm', unread ? 'text-cream' : 'text-muted')}>
                {last?.sender_id === meId && <span className="text-faint">You: </span>}
                {last?.deleted_at ? <span className="italic">Message unsent</span> : last && previewText(last)}
              </p>
            )}
            {unread && (
              <span
                className={clsx(
                  'grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-bold',
                  match.muted ? 'bg-line-strong text-cream' : 'bg-gradient-brand text-ink',
                )}
              >
                {match.unread_count}
              </span>
            )}
          </div>
        </div>
      </NavLink>
      <div className="absolute top-1/2 right-2 -translate-y-1/2">
        <ChatMenu match={match} />
      </div>
    </div>
  )
}
