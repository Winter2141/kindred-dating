import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { TopPick, TopPicks } from '@/lib/types'
import { TopPicksList } from './TopPicks'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, swipe: vi.fn() } }
})

const pick = (id: number, name: string): TopPick =>
  ({
    id,
    name,
    age: 29,
    photos: [],
    interests: [],
    prompts: [],
    shared_interests: ['Coffee'],
    compatibility: 88,
    reason: "You're both into coffee",
    bio: '',
    job_title: '',
    city: '',
    last_active_at: new Date().toISOString(),
    is_online: false,
  }) as unknown as TopPick

const DATA: TopPicks = {
  picks: [pick(1, 'Nora'), pick(2, 'Ivy')],
  refreshes_at: new Date(Date.now() + 3 * 3_600_000 + 60_000).toISOString(),
}

beforeEach(() => vi.clearAllMocks())

describe('TopPicksList', () => {
  it('shows each pick with its reason and the refresh countdown', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TopPicksList data={DATA} loading={false} onSwiped={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getAllByText("You're both into coffee")).toHaveLength(2)
    expect(screen.getByText(/new picks in 3h/i)).toBeInTheDocument()
  })

  it('likes a pick, removes it and reports the swipe', async () => {
    vi.mocked(api.swipe).mockResolvedValue({ matched: false, match: null })
    const client = new QueryClient()
    client.setQueryData(keys.topPicks, DATA)
    const onSwiped = vi.fn()
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <TopPicksList data={DATA} loading={false} onSwiped={onSwiped} />
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Like Nora' }))
    expect(api.swipe).toHaveBeenCalledWith(1, 'like')
    await vi.waitFor(() => expect(onSwiped).toHaveBeenCalled())
    expect(onSwiped.mock.calls[0][1]).toBe('like')
    expect(client.getQueryData<TopPicks>(keys.topPicks)?.picks.map((p) => p.name)).toEqual(['Ivy'])
  })

  it('says when today is done', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TopPicksList data={{ ...DATA, picks: [] }} loading={false} onSwiped={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/been through today's picks/i)).toBeInTheDocument()
  })
})
