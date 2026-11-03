import type { AppNotification, NotificationList } from './types'

/** Fold a pushed notification into the cached feed. Collapsed ones come back with the same id. */
export function applyNotification(
  feed: NotificationList | undefined,
  notification: AppNotification,
): NotificationList | undefined {
  if (!feed) return feed
  const existing = feed.items.find((n) => n.id === notification.id)
  const wasUnread = existing ? existing.read_at === null : false
  const isUnread = notification.read_at === null
  return {
    items: [notification, ...feed.items.filter((n) => n.id !== notification.id)],
    unread: feed.unread + (isUnread && !wasUnread ? 1 : 0),
  }
}

export function markNotificationRead(feed: NotificationList | undefined, id: number, readAt: string) {
  if (!feed) return feed
  const target = feed.items.find((n) => n.id === id)
  if (!target || target.read_at) return feed
  return {
    items: feed.items.map((n) => (n.id === id ? { ...n, read_at: readAt } : n)),
    unread: Math.max(0, feed.unread - 1),
  }
}

export function markAllNotificationsRead(feed: NotificationList | undefined, readAt: string) {
  if (!feed) return feed
  return { items: feed.items.map((n) => ({ ...n, read_at: n.read_at ?? readAt })), unread: 0 }
}

export function notificationText(n: AppNotification): string {
  const name = n.actor?.name ?? 'Someone'
  switch (n.kind) {
    case 'like':
      return `${name} liked you`
    case 'super_like':
      return `${name} super liked you ⭐`
    case 'match':
      return `It's a match with ${name}!`
    case 'message':
      return n.count > 1 ? `${name} sent you ${n.count} messages` : `${name} sent you a message`
    case 'date_reminder':
      return n.body || `Your date with ${name} is coming up`
    case 'verified':
      return 'Your photos are verified ✓'
    case 'verification_rejected':
      return n.body ? `Verification didn't go through: ${n.body}` : "Verification didn't go through"
  }
}

/** Where tapping a notification takes you. */
export function notificationHref(n: AppNotification): string {
  if ((n.kind === 'match' || n.kind === 'message' || n.kind === 'date_reminder') && n.match_id) {
    return `/app/matches/${n.match_id}`
  }
  if (n.kind === 'verified' || n.kind === 'verification_rejected') return '/app/settings'
  return '/app/likes'
}
