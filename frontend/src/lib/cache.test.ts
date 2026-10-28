import { describe, expect, it } from 'vitest'
import {
  applyMessageToMatches,
  applyReadReceipt,
  clearUnread,
  markPendingFailed,
  setPresence,
  totalUnread,
  upsertMessage,
} from './cache'
import type { Match, Message } from './types'

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 1,
  match_id: 10,
  sender_id: 1,
  body: 'hi',
  created_at: '2026-10-28T10:00:00Z',
  read_at: null,
  ...overrides,
})

const match = (id: number, overrides: Partial<Match> = {}): Match => ({
  id,
  user: {
    id: 100 + id,
    name: `Person ${id}`,
    age: 28,
    gender: 'woman',
    bio: '',
    job_title: '',
    city: '',
    interests: [],
    photos: [],
    prompts: [],
    last_active_at: '2026-10-28T09:00:00Z',
    is_online: false,
  },
  created_at: '2026-10-27T10:00:00Z',
  last_activity_at: '2026-10-27T10:00:00Z',
  last_message: null,
  unread_count: 0,
  ...overrides,
})

describe('upsertMessage', () => {
  it('replaces the optimistic copy with the confirmed message', () => {
    const pending = message({ id: Number.MAX_SAFE_INTEGER, pending: 'c1' })
    const list = upsertMessage([message({ id: 1 }), pending], message({ id: 2, body: 'yo' }), 'c1')
    expect(list.map((m) => m.id)).toEqual([1, 2])
    expect(list.some((m) => m.pending)).toBe(false)
  })

  it('ignores duplicates and keeps id order with pending messages last', () => {
    const pending = message({ id: Number.MAX_SAFE_INTEGER, pending: 'c9' })
    const once = upsertMessage([message({ id: 3 }), pending], message({ id: 2 }))
    const twice = upsertMessage(once, message({ id: 2 }))
    expect(twice.map((m) => m.id)).toEqual([2, 3, Number.MAX_SAFE_INTEGER])
  })

  it('marks a pending message as failed', () => {
    const list = markPendingFailed([message({ pending: 'c1' }), message({ id: 2 })], 'c1')
    expect(list[0].failed).toBe(true)
    expect(list[1].failed).toBeUndefined()
  })
})

describe('applyReadReceipt', () => {
  it('only marks messages sent by the other person', () => {
    const list = [
      message({ id: 1, sender_id: 1 }),
      message({ id: 2, sender_id: 2 }),
      message({ id: 3, sender_id: 1, read_at: '2026-10-28T09:00:00Z' }),
    ]
    const read = applyReadReceipt(list, 2, '2026-10-28T11:00:00Z')!
    expect(read.map((m) => m.read_at)).toEqual([
      '2026-10-28T11:00:00Z',
      null,
      '2026-10-28T09:00:00Z',
    ])
  })
})

describe('applyMessageToMatches', () => {
  it('moves the conversation to the top and counts unread', () => {
    const matches = [match(1), match(10)]
    const incoming = message({ match_id: 10, sender_id: 110 })
    const updated = applyMessageToMatches(matches, incoming, 1, null)!
    expect(updated.map((m) => m.id)).toEqual([10, 1])
    expect(updated[0].last_message).toEqual(incoming)
    expect(updated[0].unread_count).toBe(1)
    expect(totalUnread(updated)).toBe(1)
  })

  it('does not count my own messages or the open conversation', () => {
    const matches = [match(10)]
    expect(applyMessageToMatches(matches, message({ sender_id: 1 }), 1, null)![0].unread_count).toBe(0)
    expect(applyMessageToMatches(matches, message({ sender_id: 110 }), 1, 10)![0].unread_count).toBe(0)
  })

  it('leaves unknown matches alone', () => {
    const matches = [match(1)]
    expect(applyMessageToMatches(matches, message({ match_id: 99 }), 1, null)).toBe(matches)
  })
})

describe('presence and unread helpers', () => {
  it('updates presence for the right person', () => {
    const updated = setPresence([match(1), match(2)], 102, true)!
    expect(updated.map((m) => m.user.is_online)).toEqual([false, true])
  })

  it('clears unread counts', () => {
    expect(clearUnread([match(1, { unread_count: 3 })], 1)![0].unread_count).toBe(0)
  })
})
