/** Pure helpers that fold real-time events into the React Query caches. */
import { trimQuote } from './quotes'
import type { ChatSettings, Match, Message } from './types'

export const keys = {
  me: ['me'] as const,
  strength: ['strength'] as const,
  insights: (days: number) => ['insights', days] as const,
  meta: ['meta'] as const,
  questions: ['questions'] as const,
  agreement: (userId: number) => ['agreement', userId] as const,
  discover: ['discover'] as const,
  topPicks: ['top-picks'] as const,
  likes: ['likes'] as const,
  matches: ['matches'] as const,
  match: (id: number) => ['matches', id] as const,
  messages: (id: number) => ['messages', id] as const,
  search: (query: string) => ['search', query] as const,
  icebreakers: (id: number) => ['icebreakers', id] as const,
  blocks: ['blocks'] as const,
  notifications: ['notifications'] as const,
  dates: (matchId: number) => ['dates', matchId] as const,
  dateIdeas: (matchId: number) => ['date-ideas', matchId] as const,
  upcomingDates: ['upcoming-dates'] as const,
  places: (query: string) => ['places', query] as const,
  reports: (status: string) => ['reports', status] as const,
  moderationStats: ['moderation-stats'] as const,
  members: (q: string, filter: string, page: number) => ['members', q, filter, page] as const,
  audit: ['audit'] as const,
  verification: ['verification'] as const,
  twoFactor: ['two-factor'] as const,
  verificationQueue: ['verification-queue'] as const,
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

/** Replace `userId`'s reaction on a message (null removes it). */
export function applyReaction(
  list: Message[] | undefined,
  messageId: number,
  userId: number,
  emoji: string | null,
): Message[] | undefined {
  return list?.map((m) => {
    if (m.id !== messageId) return m
    const others = (m.reactions ?? []).filter((r) => r.user_id !== userId)
    return { ...m, reactions: emoji ? [...others, { user_id: userId, emoji }] : others }
  })
}

/** Blank out an unsent message (and quotes of it), in a conversation and in the chat list preview. */
export function applyUnsend(list: Message[] | undefined, messageId: number, deletedAt: string): Message[] | undefined {
  return list?.map((m) => {
    if (m.id === messageId) {
      return { ...m, body: '', image_url: null, audio_url: null, waveform: null, deleted_at: deletedAt, reactions: [] }
    }
    if (m.reply_to?.id === messageId) {
      return { ...m, reply_to: { ...m.reply_to, body: '', image_url: null, audio_url: null, deleted_at: deletedAt } }
    }
    return m
  })
}

/** Swap in an edited message's text, wherever it appears or is quoted. */
export function applyEdit(list: Message[] | undefined, edited: Pick<Message, 'id' | 'body' | 'edited_at'>): Message[] | undefined {
  return list?.map((m) => {
    if (m.id === edited.id) return { ...m, body: edited.body, edited_at: edited.edited_at }
    if (m.reply_to?.id === edited.id) return { ...m, reply_to: { ...m.reply_to, body: trimQuote(edited.body) } }
    return m
  })
}

export function applyEditToMatches(matches: Match[] | undefined, edited: Pick<Message, 'id' | 'body' | 'edited_at'>): Match[] | undefined {
  return matches?.map((m) =>
    m.last_message?.id === edited.id
      ? { ...m, last_message: { ...m.last_message, body: edited.body, edited_at: edited.edited_at } }
      : m,
  )
}

export function applyUnsendToMatches(
  matches: Match[] | undefined,
  messageId: number,
  deletedAt: string,
): Match[] | undefined {
  return matches?.map((m) =>
    m.last_message?.id === messageId
      ? { ...m, last_message: { ...m.last_message, body: '', deleted_at: deletedAt } }
      : m,
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
  return pinnedFirst([updated, ...matches.slice(0, index), ...matches.slice(index + 1)])
}

/** Keep pinned chats on top (in their order) without reshuffling the rest. */
export function pinnedFirst(matches: Match[]): Match[] {
  return [...matches.filter((m) => m.pinned), ...matches.filter((m) => !m.pinned)]
}

/** Fold a chat's new pin/mute/archive state into the list. A newly pinned chat goes last among pins. */
export function applyChatSettings(
  matches: Match[] | undefined,
  matchId: number,
  settings: Partial<ChatSettings>,
): Match[] | undefined {
  if (!matches) return matches
  const current = matches.find((m) => m.id === matchId)
  if (!current) return matches
  const updated = { ...current, ...settings }
  const others = matches.filter((m) => m.id !== matchId)
  if (updated.pinned && !current.pinned) {
    const pins = others.filter((m) => m.pinned)
    return [...pins, updated, ...others.filter((m) => !m.pinned)]
  }
  if (!updated.pinned && current.pinned) {
    // Unpinned: back among the rest, by recent activity.
    const rest = [...others.filter((m) => !m.pinned), updated].sort(
      (a, b) => Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at),
    )
    return [...others.filter((m) => m.pinned), ...rest]
  }
  return matches.map((m) => (m.id === matchId ? updated : m))
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

/** Chats with unread messages, not counting muted ones. */
export function totalUnread(matches: Match[] | undefined): number {
  return (matches ?? []).reduce((sum, m) => sum + (m.unread_count > 0 && !m.muted ? 1 : 0), 0)
}
