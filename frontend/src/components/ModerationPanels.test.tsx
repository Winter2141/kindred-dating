import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { AdminUser, AuditEvent } from '@/lib/types'
import { AuditPanel, MembersPanel, describeAudit } from './ModerationPanels'

afterEach(() => vi.restoreAllMocks())

const wrap = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)

const member = (overrides: Partial<AdminUser> = {}): AdminUser =>
  ({
    id: 7,
    name: 'Sam',
    age: 31,
    photos: [],
    email: 'sam@example.com',
    created_at: new Date().toISOString(),
    banned: false,
    verified: false,
    email_verified: true,
    is_admin: false,
    is_persona: false,
    open_reports: 2,
    matches: 3,
    ...overrides,
  }) as AdminUser

const event = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 1,
  action: 'user.banned',
  actor_name: 'Alex',
  target: { name: 'Sam' } as AuditEvent['target'],
  detail: 'Spam links',
  created_at: new Date().toISOString(),
  ...overrides,
})

describe('describeAudit', () => {
  it('reads as a sentence, even for deleted people', () => {
    expect(describeAudit(event())).toBe('Alex banned Sam')
    expect(describeAudit(event({ action: 'verification.approved' }))).toBe('Alex verified the photos of Sam')
    expect(describeAudit(event({ actor_name: null, target: null }))).toBe('A former moderator banned a deleted account')
    expect(describeAudit(event({ action: 'announcement.posted', target: null }))).toBe('Alex posted an announcement')
  })
})

describe('MembersPanel', () => {
  it('searches, then bans with a reason', async () => {
    const members = vi.spyOn(api, 'members').mockResolvedValue({ total: 1, items: [member()] })
    const ban = vi.spyOn(api, 'banMember').mockResolvedValue()
    const user = userEvent.setup()
    render(wrap(<MembersPanel />))

    expect(await screen.findByText('sam@example.com')).toBeInTheDocument()
    expect(screen.getByText('2 open reports')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search members'), 'sam')
    await vi.waitFor(() => expect(members).toHaveBeenLastCalledWith({ q: 'sam', filter: 'all', limit: 20, offset: 0 }))

    await user.click(screen.getByRole('button', { name: 'Ban' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'Spam links')
    await user.click(within(dialog).getByRole('button', { name: /ban/i }))
    expect(ban).toHaveBeenCalledWith(7, 'Spam links')
  })

  it('filters by status', async () => {
    const members = vi.spyOn(api, 'members').mockResolvedValue({ total: 0, items: [] })
    const user = userEvent.setup()
    render(wrap(<MembersPanel />))
    await user.click(await screen.findByRole('button', { name: 'Banned' }))
    await vi.waitFor(() => expect(members).toHaveBeenLastCalledWith({ q: '', filter: 'banned', limit: 20, offset: 0 }))
    expect(await screen.findByText('No one matches')).toBeInTheDocument()
  })
})

describe('AuditPanel', () => {
  it('lists what moderators did, with the reason', async () => {
    vi.spyOn(api, 'audit').mockResolvedValue([event(), event({ id: 2, action: 'user.unbanned', detail: '' })])
    render(wrap(<AuditPanel />))
    expect(await screen.findByText('Alex banned Sam')).toBeInTheDocument()
    expect(screen.getByText('“Spam links”')).toBeInTheDocument()
    expect(screen.getByText('Alex unbanned Sam')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /load older/i })).not.toBeInTheDocument()
  })
})
