import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { DeviceSession, Me } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { DeviceList, deviceActivity } from './Devices'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      deviceSessions: vi.fn(),
      endSession: vi.fn(),
      signOutOtherSessions: vi.fn(),
    },
  }
})

const NOW = new Date('2026-11-03T12:00:00Z')

function device(overrides: Partial<DeviceSession>): DeviceSession {
  return {
    id: 1,
    label: 'Edge on Windows',
    mobile: false,
    ip_address: '203.0.113.7',
    created_at: '2026-10-28T09:00:00Z',
    last_seen_at: '2026-11-03T11:58:00Z',
    current: false,
    ...overrides,
  }
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.mocked(api.deviceSessions).mockReset()
  vi.mocked(api.endSession).mockReset().mockResolvedValue(undefined)
  vi.mocked(api.signOutOtherSessions).mockReset().mockResolvedValue(undefined)
  useAuth.setState({ token: 'token', user: { id: 1 } as Me })
})

describe('deviceActivity', () => {
  it('calls out this device first', () => {
    expect(deviceActivity(device({ current: true, last_seen_at: '2026-10-01T00:00:00Z' }), NOW)).toBe('This device')
  })

  it('says active now inside the five minutes the server rounds to', () => {
    expect(deviceActivity(device({ last_seen_at: '2026-11-03T11:57:00Z' }), NOW)).toBe('Active now')
  })

  it('falls back to how long ago', () => {
    expect(deviceActivity(device({ last_seen_at: '2026-11-03T09:00:00Z' }), NOW)).toBe('Active 3h ago')
    expect(deviceActivity(device({ last_seen_at: '2026-11-01T12:00:00Z' }), NOW)).toBe('Active 2d ago')
  })
})

describe('DeviceList', () => {
  it('lists devices and signs one out', async () => {
    vi.mocked(api.deviceSessions)
      .mockResolvedValueOnce([
        device({ id: 1, current: true }),
        device({ id: 2, label: 'Safari on iPhone', mobile: true }),
      ])
      .mockResolvedValueOnce([device({ id: 1, current: true })])
    const user = userEvent.setup()
    render(wrap(<DeviceList />))

    const list = await screen.findByRole('list', { name: 'Signed-in devices' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('This device')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign out Safari on iPhone' }))
    expect(api.endSession).toHaveBeenCalledWith(2)
    await vi.waitFor(() => expect(screen.queryByText('Safari on iPhone')).not.toBeInTheDocument())
    expect(useAuth.getState().token).toBe('token')
    // With nothing else signed in, there's nothing to sign out of.
    expect(screen.queryByRole('button', { name: /all other devices/i })).not.toBeInTheDocument()
  })

  it('signing out this device signs you out here', async () => {
    vi.mocked(api.deviceSessions).mockResolvedValue([device({ id: 1, current: true })])
    const user = userEvent.setup()
    render(wrap(<DeviceList />))

    await user.click(await screen.findByRole('button', { name: 'Sign out of this device' }))
    await vi.waitFor(() => expect(useAuth.getState().token).toBeNull())
  })

  it('signs out of every other device at once', async () => {
    vi.mocked(api.deviceSessions).mockResolvedValue([device({ id: 1, current: true }), device({ id: 2 }), device({ id: 3 })])
    const user = userEvent.setup()
    render(wrap(<DeviceList />))

    await user.click(await screen.findByRole('button', { name: /all other devices/i }))
    expect(api.signOutOtherSessions).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(api.deviceSessions).toHaveBeenCalledTimes(2))
  })

  it('says so when the list fails to load', async () => {
    vi.mocked(api.deviceSessions).mockRejectedValue(new Error('Network down'))
    render(wrap(<DeviceList />))
    expect(await screen.findByText(/couldn't load your devices/i)).toHaveTextContent('Network down')
  })
})
