import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { Match, PublicProfile, SavedProfile, SwipeResult } from '@/lib/types'
import { SavedList } from './Saved'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, saved: vi.fn(), unsaveProfile: vi.fn(), swipe: vi.fn() } }
})

const person = (id: number, name: string) => ({ id, name, age: 29, photos: [] }) as unknown as PublicProfile
const SAVED: SavedProfile[] = [
  { user: person(4, 'Inês'), saved_at: new Date().toISOString() },
  { user: person(5, 'Beatriz'), saved_at: new Date().toISOString() },
]

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(api.saved).mockReset().mockResolvedValue(SAVED)
  vi.mocked(api.unsaveProfile).mockReset().mockResolvedValue()
  vi.mocked(api.swipe).mockReset()
})

describe('SavedList', () => {
  it('likes someone saved, and celebrates a match', async () => {
    const match = { id: 9 } as Match
    vi.mocked(api.swipe).mockResolvedValue({ matched: true, match } as SwipeResult)
    const onMatch = vi.fn()
    const user = userEvent.setup()
    render(wrap(<SavedList onOpen={vi.fn()} onMatch={onMatch} />))

    await user.click(await screen.findByRole('button', { name: 'Like Inês' }))
    expect(api.swipe).toHaveBeenCalledWith(4, 'like')
    await vi.waitFor(() => expect(onMatch).toHaveBeenCalledWith(match))
    expect(screen.queryByText('Inês')).not.toBeInTheDocument()
    expect(screen.getByText('Beatriz')).toBeInTheDocument()
  })

  it('passes on someone or puts them back in the deck', async () => {
    vi.mocked(api.swipe).mockResolvedValue({ matched: false } as SwipeResult)
    const user = userEvent.setup()
    render(wrap(<SavedList onOpen={vi.fn()} onMatch={vi.fn()} />))

    await user.click(await screen.findByRole('button', { name: 'Pass on Inês' }))
    expect(api.swipe).toHaveBeenCalledWith(4, 'pass')
    await user.click(screen.getByRole('button', { name: 'Put Beatriz back in Discover' }))
    expect(api.unsaveProfile).toHaveBeenCalledWith(5)
    expect(await screen.findByText('Nobody saved yet')).toBeInTheDocument()
  })

  it('opens a profile', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(wrap(<SavedList onOpen={onOpen} onMatch={vi.fn()} />))
    await user.click(await screen.findByRole('button', { name: "View Beatriz's profile" }))
    expect(onOpen).toHaveBeenCalledWith(SAVED[1].user)
  })
})
