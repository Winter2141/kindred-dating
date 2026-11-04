import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { PublicProfile, Viewer } from '@/lib/types'
import { ViewedYouList, timesLabel } from './ViewedYou'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, viewers: vi.fn() } }
})

const PROFILE = {
  id: 4,
  name: 'Harriet',
  age: 30,
  photos: [],
  verified: true,
  visiting: 'Brooklyn, NY',
} as unknown as PublicProfile

const VIEWER: Viewer = { user: PROFILE, viewed_at: new Date().toISOString(), times: 3, liked_you: true }

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => vi.mocked(api.viewers).mockReset())

describe('timesLabel', () => {
  it('reads naturally', () => {
    expect(timesLabel(1)).toBe('Looked once')
    expect(timesLabel(4)).toBe('Looked 4 times')
  })
})

describe('ViewedYouList', () => {
  it('lists who looked, and opens one', async () => {
    vi.mocked(api.viewers).mockResolvedValue({ private: false, viewers: [VIEWER] })
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(wrap(<ViewedYouList onOpen={onOpen} />))

    const row = await screen.findByRole('button', { name: 'Harriet, looked 3 times' })
    expect(row).toHaveTextContent('Likes you')
    expect(row).toHaveTextContent('Visiting Brooklyn')
    await user.click(row)
    expect(onOpen).toHaveBeenCalledWith(VIEWER)
  })

  it('explains an empty list', async () => {
    vi.mocked(api.viewers).mockResolvedValue({ private: false, viewers: [] })
    render(wrap(<ViewedYouList onOpen={vi.fn()} />))
    expect(await screen.findByText('No views in the last 30 days')).toBeInTheDocument()
  })

  it('hides viewers from people browsing privately', async () => {
    vi.mocked(api.viewers).mockResolvedValue({ private: true, viewers: [] })
    render(wrap(<ViewedYouList onOpen={vi.fn()} />))
    expect(await screen.findByText("You're browsing privately")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change in Settings' })).toHaveAttribute('href', '/app/settings')
  })
})
