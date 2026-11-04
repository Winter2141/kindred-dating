import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { Like, PublicProfile } from '@/lib/types'
import { LikesPage } from './Likes'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, likes: vi.fn(), viewers: vi.fn(), saved: vi.fn(), recordView: vi.fn() },
  }
})

const NORA = { id: 3, name: 'Nora', age: 26, photos: [], interests: [], prompts: [] } as unknown as PublicProfile

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <LikesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.likes)
    .mockReset()
    .mockResolvedValue([{ user: NORA, action: 'like', created_at: new Date().toISOString() } as Like])
  vi.mocked(api.viewers).mockReset().mockResolvedValue({ private: false, viewers: [] })
  vi.mocked(api.saved)
    .mockReset()
    .mockResolvedValue([{ user: NORA, saved_at: new Date().toISOString() }])
  vi.mocked(api.recordView).mockReset().mockResolvedValue()
})

describe('LikesPage', () => {
  it('switches between likes, viewers and saved people', async () => {
    const user = userEvent.setup()
    renderAt('/app/likes')
    expect(screen.getByRole('heading', { name: 'Likes you' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: "View Nora's profile" })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Viewed you' }))
    expect(screen.getByRole('heading', { name: 'Viewed you' })).toBeInTheDocument()
    expect(await screen.findByText('No views in the last 30 days')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Saved' }))
    expect(screen.getByRole('tab', { name: 'Saved' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('button', { name: 'Like Nora' })).toBeInTheDocument()
  })

  it('opens on the tab in the link', async () => {
    renderAt('/app/likes?tab=saved')
    expect(screen.getByRole('heading', { name: 'Saved for later' })).toBeInTheDocument()
    expect(api.likes).toHaveBeenCalled()
  })

  it('counts opening a like as a view of their profile', async () => {
    const user = userEvent.setup()
    renderAt('/app/likes')
    await user.click(await screen.findByRole('button', { name: "View Nora's profile" }))
    expect(await screen.findByRole('dialog', { name: "Nora's profile" })).toBeInTheDocument()
    await vi.waitFor(() => expect(api.recordView).toHaveBeenCalledWith(3))
  })
})
