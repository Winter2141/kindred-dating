import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { AdminReport, Me } from '@/lib/types'
import { ModerationPage } from './Moderation'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, me: vi.fn(), reports: vi.fn(), moderationStats: vi.fn(), resolveReport: vi.fn() },
  }
})

const person = (id: number, name: string) => ({
  id,
  name,
  age: 31,
  photos: [],
  email: `${name.toLowerCase()}@example.com`,
  banned: false,
  open_reports: 2,
  unkind_messages: 0,
})

const REPORT = {
  id: 11,
  reason: 'spam',
  details: 'Pitched me a crypto course',
  status: 'open',
  created_at: new Date().toISOString(),
  resolved_at: null,
  reporter: person(2, 'Elena'),
  reported: person(3, 'Ryan'),
} as unknown as AdminReport

function renderPage(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.reports).mockResolvedValue([REPORT])
  vi.mocked(api.moderationStats).mockResolvedValue({
    pending_verifications: 0,
    open_reports: 1,
    resolved_this_week: 3,
    banned_users: 0,
    total_users: 48,
  })
  vi.mocked(api.me).mockResolvedValue({ id: 1, is_admin: true } as Me)
})

describe('ModerationPage', () => {
  it('shows the queue with the reason and context', async () => {
    renderPage(<ModerationPage />)
    const card = await screen.findByRole('article')
    expect(within(card).getByText('Ryan, 31')).toBeInTheDocument()
    expect(within(card).getByText('Spam or scam')).toBeInTheDocument()
    expect(within(card).getByText('2 open reports')).toBeInTheDocument()
    expect(within(card).getByText('Pitched me a crypto course')).toBeInTheDocument()
    expect(screen.getByText('48')).toBeInTheDocument()
  })

  it('flags people whose messages read as insults', async () => {
    vi.mocked(api.reports).mockResolvedValue([
      { ...REPORT, reported: { ...REPORT.reported, unkind_messages: 3 } },
    ])
    renderPage(<ModerationPage />)
    const card = await screen.findByRole('article')
    expect(within(card).getByText(/3 unkind messages/)).toBeInTheDocument()
  })

  it('says nothing about kindness when there is nothing to say', async () => {
    renderPage(<ModerationPage />)
    const card = await screen.findByRole('article')
    expect(within(card).queryByText(/unkind/)).not.toBeInTheDocument()
  })

  it('dismisses a report and refreshes the queue', async () => {
    vi.mocked(api.resolveReport).mockResolvedValue({ ...REPORT, status: 'dismissed' })
    const user = userEvent.setup()
    renderPage(<ModerationPage />)
    await user.click(await screen.findByRole('button', { name: /dismiss/i }))
    expect(api.resolveReport).toHaveBeenCalledWith(11, 'dismiss')
    await vi.waitFor(() => expect(api.reports).toHaveBeenCalledTimes(2))
  })

  it('switches tabs', async () => {
    const user = userEvent.setup()
    renderPage(<ModerationPage />)
    await screen.findByRole('article')
    await user.click(screen.getByRole('tab', { name: 'Actioned' }))
    expect(api.reports).toHaveBeenLastCalledWith('actioned')
  })

  it('sends members who are not moderators away', async () => {
    vi.mocked(api.me).mockResolvedValue({ id: 1, is_admin: false } as Me)
    renderPage(<ModerationPage />)
    await vi.waitFor(() => expect(api.me).toHaveBeenCalled())
    expect(screen.queryByText('Keep Kindred kind')).not.toBeInTheDocument()
    expect(api.reports).not.toHaveBeenCalled()
  })
})
