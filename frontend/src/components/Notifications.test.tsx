import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { NotificationList, PublicProfile } from '@/lib/types'
import { NotificationPanel } from './Notifications'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, readNotification: vi.fn(), readAllNotifications: vi.fn() },
  }
})

const maya = { id: 3, name: 'Maya', photos: [] } as unknown as PublicProfile
const FEED: NotificationList = {
  unread: 1,
  items: [
    {
      id: 7,
      kind: 'message',
      actor: maya,
      match_id: 12,
      body: 'Testing a cardamom bun recipe',
      count: 2,
      created_at: new Date().toISOString(),
      read_at: null,
    },
  ],
}

beforeEach(() => vi.clearAllMocks())

function renderPanel(onNavigate = vi.fn()) {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/discover']}>
        <Routes>
          <Route path="/app/discover" element={<NotificationPanel feed={FEED} loading={false} onNavigate={onNavigate} />} />
          <Route path="/app/matches/:id" element={<p>Chat page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return onNavigate
}

describe('NotificationPanel', () => {
  it('opens the chat for a missed message and marks it read', async () => {
    vi.mocked(api.readNotification).mockResolvedValue(FEED.items[0])
    const user = userEvent.setup()
    const onNavigate = renderPanel()
    await user.click(screen.getByRole('button', { name: /maya sent you 2 messages/i }))
    expect(api.readNotification).toHaveBeenCalledWith(7)
    expect(onNavigate).toHaveBeenCalled()
    expect(await screen.findByText('Chat page')).toBeInTheDocument()
  })

  it('can mark everything read', async () => {
    vi.mocked(api.readAllNotifications).mockResolvedValue()
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: /mark all read/i }))
    expect(api.readAllNotifications).toHaveBeenCalled()
  })
})
