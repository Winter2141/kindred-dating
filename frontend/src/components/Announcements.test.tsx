import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { AdminAnnouncement, Announcement } from '@/lib/types'
import { AnnouncementBanner, AnnouncementsPanel } from './Announcements'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      announcements: vi.fn(),
      dismissAnnouncement: vi.fn(),
      adminAnnouncements: vi.fn(),
      postAnnouncement: vi.fn(),
      endAnnouncement: vi.fn(),
    },
  }
})

const NEWS: Announcement = {
  id: 1,
  title: 'Video calls are here',
  body: 'Tap the camera in any chat.',
  tone: 'celebration',
  created_at: new Date().toISOString(),
  ends_at: null,
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  for (const fn of [
    api.announcements,
    api.dismissAnnouncement,
    api.adminAnnouncements,
    api.postAnnouncement,
    api.endAnnouncement,
  ]) {
    vi.mocked(fn).mockReset()
  }
})

describe('AnnouncementBanner', () => {
  it('shows the newest announcement and dismisses it', async () => {
    const older = { ...NEWS, id: 2, title: 'Maintenance on Sunday', tone: 'warning' as const }
    vi.mocked(api.announcements).mockResolvedValue([NEWS, older])
    vi.mocked(api.dismissAnnouncement).mockResolvedValue()
    const user = userEvent.setup()
    render(wrap(<AnnouncementBanner />))

    expect(await screen.findByText('Video calls are here')).toBeInTheDocument()
    expect(screen.getByText(/Tap the camera/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss announcement' }))
    expect(api.dismissAnnouncement).toHaveBeenCalledWith(1)
    // The next one takes its place.
    expect(await screen.findByText('Maintenance on Sunday')).toBeInTheDocument()
  })

  it('renders nothing when there is nothing to say', async () => {
    vi.mocked(api.announcements).mockResolvedValue([])
    const { container } = render(wrap(<AnnouncementBanner />))
    await vi.waitFor(() => expect(api.announcements).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe('AnnouncementsPanel', () => {
  const posted: AdminAnnouncement = { ...NEWS, active: true, author_name: 'Alex', dismissed_count: 12 }

  it('posts an announcement with a kind and a duration', async () => {
    vi.mocked(api.adminAnnouncements).mockResolvedValue([])
    vi.mocked(api.postAnnouncement).mockResolvedValue(posted)
    const user = userEvent.setup()
    render(wrap(<AnnouncementsPanel />))

    expect(await screen.findByText('Nothing posted yet')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Headline'), '  Video calls are here ')
    await user.click(screen.getByRole('button', { name: /Heads up/ }))
    await user.selectOptions(screen.getByLabelText('Keep it up for'), 'Until I end it')
    await user.click(screen.getByRole('button', { name: /post to everyone/i }))
    expect(api.postAnnouncement).toHaveBeenCalledWith({
      title: 'Video calls are here',
      body: '',
      tone: 'warning',
      hours: null,
    })
  })

  it('lists posted announcements and ends one', async () => {
    vi.mocked(api.adminAnnouncements).mockResolvedValue([
      posted,
      { ...posted, id: 3, title: 'Old news', active: false },
    ])
    vi.mocked(api.endAnnouncement).mockResolvedValue({ ...posted, active: false })
    const user = userEvent.setup()
    render(wrap(<AnnouncementsPanel />))

    expect(await screen.findAllByText(/Alex · .* · 12 dismissed/)).toHaveLength(2)
    expect(screen.getByText('Ended')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'End now' }))
    expect(api.endAnnouncement).toHaveBeenCalledWith(1)
  })
})
