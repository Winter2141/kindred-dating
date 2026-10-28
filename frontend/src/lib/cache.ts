/** Pure helpers that fold real-time events into the React Query caches. */
import type { Match, Message } from './types'

export const keys = {
  me: ['me'] as const,
  meta: ['meta'] as const,
  discover: ['discover'] as const,
  likes: ['likes'] as const,
  matches: ['matches'] as const,
  match: (id: number) => ['matches', id] as const,
  messages: (id: number) => ['messages', id] as const,
  icebreakers: (id: number) => ['icebreakers', id] as const,
}

/** Insert or replace a message, swapping out the optimistic copy that has the same client id. */
export function upsertMessage(
  list: Message[] | undefined,
  message: Message,
  clientId?: string | null,
): Message[] {
  const current = list ?? []
  const withoutDupes = current.filter(
    (m) => m.id !== message.id && !(clientId && m.pending === clientId),
  )
  const confirmed = withoutDupes.filter((m) => !m.pending)
  const pending = withoutDupes.filter((m) => m.pending)
  confirmed.push(message)
  confirmed.sort((a, b) => a.id - b.id)
  return [...confirmed, ...pending]
}

export function markPendingFailed(list: Message[] | undefined, clientId: string): Message[] {
  return (list ?? []).map((m) => (m.pending === clientId ? { ...m, failed: true } : m))
}

/** The other person read everything I sent before `readAt`. */
export function applyReadReceipt(
  list: Message[] | undefined,
  readerId: number,
  readAt: string,
): Message[] | undefined {
  if (!list) return list
  return list.map((m) =>
    m.sender_id !== readerId && !m.read_at && !m.pending ? { ...m, read_at: readAt } : m,
  )
}

export function applyMessageToMatches(
  matches: Match[] | undefined,
  message: Message,
  viewerId: number,
  activeMatchId: number | null,
): Match[] | undefined {
  if (!matches) return matches
  const index = matches.findIndex((m) => m.id === message.match_id)
  if (index === -1) return matches
  const match = matches[index]
  const counts = message.sender_id !== viewerId && message.match_id !== activeMatchId
  const updated: Match = {
    ...match,
    last_message: message,
    last_activity_at: message.created_at,
    unread_count: counts ? match.unread_count + 1 : match.unread_count,
  }
  return [updated, ...matches.slice(0, index), ...matches.slice(index + 1)]
}

export function clearUnread(matches: Match[] | undefined, matchId: number): Match[] | undefined {
  return matches?.map((m) => (m.id === matchId ? { ...m, unread_count: 0 } : m))
}

export function setPresence(
  matches: Match[] | undefined,
  userId: number,
  online: boolean,
  lastActiveAt?: string,
): Match[] | undefined {
  return matches?.map((m) =>
    m.user.id === userId
      ? {
          ...m,
          user: { ...m.user, is_online: online, last_active_at: lastActiveAt ?? m.user.last_active_at },
        }
      : m,
  )
}

export function totalUnread(matches: Match[] | undefined): number {
  return (matches ?? []).reduce((sum, m) => sum + (m.unread_count > 0 ? 1 : 0), 0)
}
