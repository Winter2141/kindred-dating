import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { QuietHours } from '@/lib/quiet'
import type { Me } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { QuietHoursForm } from './QuietHours'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, setQuietHours: vi.fn() } }
})

const ME = { id: 1, name: 'Alex', quiet_hours: null } as Me

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function Live() {
  const user = useAuth((s) => s.user)
  return user ? <QuietHoursForm user={user} /> : null
}

beforeEach(() => {
  useAuth.getState().setUser(ME)
  vi.mocked(api.setQuietHours)
    .mockReset()
    .mockImplementation(async (quiet: QuietHours | null) => ({ ...ME, quiet_hours: quiet }))
})

afterEach(() => useAuth.getState().signOut())

describe('QuietHoursForm', () => {
  it('turns on with 10 pm to 8 am in this device’s time zone', async () => {
    const user = userEvent.setup()
    render(wrap(<Live />))
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }))
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(api.setQuietHours).toHaveBeenCalledWith({ start: 22, end: 8, timezone: zone })
    expect(await screen.findByLabelText('From')).toHaveValue('22')
    expect(screen.getByText(/10 pm to 8 am \(10 hours\)/)).toBeInTheDocument()
  })

  it('saves a new hour and offers to fix a stale time zone', async () => {
    useAuth.getState().setUser({ ...ME, quiet_hours: { start: 22, end: 8, timezone: 'Pacific/Kiritimati' } })
    const user = userEvent.setup()
    render(wrap(<Live />))

    await user.selectOptions(screen.getByLabelText('Until'), '7')
    expect(api.setQuietHours).toHaveBeenLastCalledWith({ start: 22, end: 7, timezone: 'Pacific/Kiritimati' })
    await user.click(await screen.findByRole('button', { name: /use this device's time zone/i }))
    expect(vi.mocked(api.setQuietHours).mock.lastCall?.[0]?.timezone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
  })

  it('turns off', async () => {
    useAuth.getState().setUser({ ...ME, quiet_hours: { start: 22, end: 8, timezone: 'UTC' } })
    const user = userEvent.setup()
    render(wrap(<Live />))
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }))
    expect(api.setQuietHours).toHaveBeenCalledWith(null)
    await vi.waitFor(() => expect(screen.queryByLabelText('From')).not.toBeInTheDocument())
  })
})
