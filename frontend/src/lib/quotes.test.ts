import { describe, expect, it } from 'vitest'
import { applyEdit, applyEditToMatches } from './cache'
import type { Match, Message } from './types'

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 1,
  match_id: 3,
  sender_id: 7,
  body: 'See you at 7',
  created_at: '2026-11-03T10:00:00Z',
  read_at: null,
  ...overrides,
})

describe('applyEdit', () => {
  it('replaces the text and the quotes of it', () => {
    const original = message()
    const reply = message({
      id: 2,
      sender_id: 8,
      body: 'Perfect',
      reply_to: { id: 1, sender_id: 7, body: 'See you at 7', image_url: null, deleted_at: null },
    })
    const edited = { id: 1, body: 'See you at 8', edited_at: '2026-11-03T10:01:00Z' }
    const [first, second] = applyEdit([original, reply], edited)!
    expect(first).toMatchObject(edited)
    expect(second.body).toBe('Perfect')
    expect(second.reply_to?.body).toBe('See you at 8')
  })

  it('trims long edits inside quotes', () => {
    const reply = message({
      id: 2,
      reply_to: { id: 1, sender_id: 7, body: 'short', image_url: null, deleted_at: null },
    })
    const [updated] = applyEdit([reply], { id: 1, body: 'x'.repeat(400), edited_at: 'now' })!
    expect(updated.reply_to!.body.length).toBeLessThanOrEqual(160)
  })

  it('updates the chat list preview', () => {
    const match = { id: 3, last_message: message() } as Match
    const [updated] = applyEditToMatches([match], { id: 1, body: 'See you at 8', edited_at: 'now' })!
    expect(updated.last_message?.body).toBe('See you at 8')
  })
})
