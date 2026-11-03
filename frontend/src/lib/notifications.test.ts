import { describe, expect, it } from 'vitest'
import {
  applyNotification,
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
  notificationText,
} from './notifications'
import type { AppNotification, PublicProfile } from './types'

const sam = { id: 9, name: 'Sam', photos: [] } as unknown as PublicProfile
const make = (overrides: Partial<AppNotification>): AppNotification => ({
  id: 1,
  kind: 'like',
  actor: sam,
  match_id: null,
  body: '',
  count: 1,
  created_at: '2026-11-02T10:00:00Z',
  read_at: null,
  ...overrides,
})

describe('applyNotification', () => {
  it('puts new notifications on top and counts them', () => {
    const feed = { items: [make({ id: 1, read_at: 'x' })], unread: 0 }
    const next = applyNotification(feed, make({ id: 2, kind: 'match' }))
    expect(next?.items.map((n) => n.id)).toEqual([2, 1])
    expect(next?.unread).toBe(1)
  })

  it('moves a collapsed notification up without counting it twice', () => {
    const feed = { items: [make({ id: 2 }), make({ id: 1, kind: 'message', count: 1 })], unread: 2 }
    const next = applyNotification(feed, make({ id: 1, kind: 'message', count: 2 }))
    expect(next?.items.map((n) => [n.id, n.count])).toEqual([
      [1, 2],
      [2, 1],
    ])
    expect(next?.unread).toBe(2)
  })

  it('counts a collapsed notification again once it had been read', () => {
    const feed = { items: [make({ id: 1, kind: 'message', read_at: 'x' })], unread: 0 }
    expect(applyNotification(feed, make({ id: 1, kind: 'message', count: 2 }))?.unread).toBe(1)
    expect(applyNotification(undefined, make({}))).toBeUndefined()
  })
})

describe('marking read', () => {
  it('marks one or all and keeps the count right', () => {
    const feed = { items: [make({ id: 1 }), make({ id: 2 })], unread: 2 }
    const one = markNotificationRead(feed, 1, 'now')
    expect(one?.unread).toBe(1)
    expect(markNotificationRead(one, 1, 'later')).toBe(one)
    const all = markAllNotificationsRead(one, 'later')
    expect(all?.unread).toBe(0)
    expect(all?.items.map((n) => n.read_at)).toEqual(['now', 'later'])
  })
})

describe('notificationText and notificationHref', () => {
  it('describes each kind and links to the right place', () => {
    expect(notificationText(make({ kind: 'like' }))).toBe('Sam liked you')
    expect(notificationText(make({ kind: 'super_like' }))).toBe('Sam super liked you ⭐')
    expect(notificationText(make({ kind: 'match' }))).toBe("It's a match with Sam!")
    expect(notificationText(make({ kind: 'message', count: 3 }))).toBe('Sam sent you 3 messages')
    expect(notificationText(make({ kind: 'like', actor: null }))).toBe('Someone liked you')
    expect(notificationHref(make({ kind: 'like' }))).toBe('/app/likes')
    expect(notificationHref(make({ kind: 'message', match_id: 4 }))).toBe('/app/matches/4')
  })
})
