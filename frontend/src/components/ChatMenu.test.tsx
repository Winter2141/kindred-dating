import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { applyChatSettings, applyMessageToMatches, keys, totalUnread } from '@/lib/cache'
import type { Match, Message } from '@/lib/types'
import { ChatMenu, muteLabel } from './ChatMenu'

afterEach(() => vi.restoreAllMocks())

const match = (id: number, overrides: Partial<Match> = {}): Match =>
  ({
    id,
    user: { id: id + 100, name: `Person ${id}`, photos: [] },
    created_at: '2026-11-01T10:00:00Z',
    last_activity_at: `2026-11-0${id}T10:00:00Z`,
    last_message: null,
    unread_count: 0,
    pinned: false,
    archived: false,
    muted: false,
    muted_until: null,
    ...overrides,
  }) as Match

describe('applyChatSettings', () => {
  it('moves a newly pinned chat below the existing pins', () => {
    const list = [match(1, { pinned: true }), match(3), match(2)]
    expect(applyChatSettings(list, 2, { pinned: true })!.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('puts an unpinned chat back by recent activity', () => {
    const list = [match(1, { pinned: true }), match(4), match(2)]
    expect(applyChatSettings(list, 1, { pinned: false })!.map((m) => m.id)).toEqual([4, 2, 1])
  })

  it('updates flags in place otherwise', () => {
    const [first] = applyChatSettings([match(1)], 1, { muted: true, muted_until: '2026-11-04T00:00:00Z' })!
    expect(first.muted).toBe(true)
  })
})

describe('applyMessageToMatches', () => {
  it('keeps pinned chats above a chat with a new message', () => {
    const list = [match(1, { pinned: true }), match(2), match(3)]
    const message = { id: 9, match_id: 3, sender_id: 103, body: 'hi', created_at: 'now', read_at: null } as Message
    expect(applyMessageToMatches(list, message, 1, null)!.map((m) => m.id)).toEqual([1, 3, 2])
  })
})

describe('totalUnread', () => {
  it('ignores muted chats', () => {
    expect(totalUnread([match(1, { unread_count: 2 }), match(2, { unread_count: 1, muted: true })])).toBe(1)
  })
})

describe('muteLabel', () => {
  const now = Date.parse('2026-11-03T10:00:00Z')
  it('describes how long a chat stays muted', () => {
    expect(muteLabel('9999-12-31T00:00:00Z', now)).toBe('Muted')
    expect(muteLabel('2026-11-03T12:30:00Z', now)).toBe('Muted for 3h')
    expect(muteLabel(null, now)).toBe('Muted')
  })
})

describe('ChatMenu', () => {
  it('mutes a chat for a chosen time and updates the list straight away', async () => {
    const save = vi.spyOn(api, 'chatSettings').mockResolvedValue({
      match_id: 2,
      pinned: false,
      archived: false,
      muted: true,
      muted_until: '2026-11-03T18:00:00Z',
    })
    const client = new QueryClient()
    client.setQueryData(keys.matches, [match(2)])
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <ChatMenu match={match(2)} />
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('button', { name: /options for your chat/i }))
    await user.click(screen.getByRole('menuitem', { name: /mute/i }))
    await user.click(screen.getByRole('menuitem', { name: 'For 8 hours' }))
    expect(save).toHaveBeenCalledWith(2, { mute: '8h' })
    expect(client.getQueryData<Match[]>(keys.matches)![0].muted).toBe(true)
  })

  it('pins and archives', async () => {
    const save = vi.spyOn(api, 'chatSettings').mockResolvedValue({
      match_id: 2,
      pinned: true,
      archived: false,
      muted: false,
      muted_until: null,
    })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChatMenu match={match(2)} />
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('button', { name: /options for your chat/i }))
    await user.click(screen.getByRole('menuitem', { name: /pin to top/i }))
    expect(save).toHaveBeenLastCalledWith(2, { pinned: true })
    await user.click(screen.getByRole('button', { name: /options for your chat/i }))
    await user.click(screen.getByRole('menuitem', { name: /archive/i }))
    expect(save).toHaveBeenLastCalledWith(2, { archived: true })
  })
})
