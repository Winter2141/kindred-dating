import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { EmailPrefs } from '@/lib/types'
import { EmailPrefsForm, allOff } from './EmailPrefs'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, emailPrefs: vi.fn(), setEmailPrefs: vi.fn() } }
})

const DEFAULTS: EmailPrefs = { matches: true, messages: true, likes: false, dates: true, email_verified: true }

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.mocked(api.emailPrefs).mockReset().mockResolvedValue(DEFAULTS)
  vi.mocked(api.setEmailPrefs).mockReset()
})

describe('allOff', () => {
  it('is true only when every category is off', () => {
    expect(allOff(DEFAULTS)).toBe(false)
    expect(allOff({ ...DEFAULTS, matches: false, messages: false, dates: false })).toBe(true)
  })
})

describe('EmailPrefsForm', () => {
  it('shows each choice and saves a change', async () => {
    vi.mocked(api.setEmailPrefs).mockImplementation(async (prefs) => ({ ...prefs, email_verified: true }))
    const user = userEvent.setup()
    render(wrap(<EmailPrefsForm />))

    const likes = await screen.findByRole('switch', { name: 'Likes' })
    expect(likes).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: 'New matches' })).toHaveAttribute('aria-checked', 'true')

    await user.click(likes)
    // Only the four choices go to the server, not the read-only email_verified flag.
    expect(vi.mocked(api.setEmailPrefs).mock.calls[0][0]).toEqual({ matches: true, messages: true, likes: true, dates: true })
    expect(likes).toHaveAttribute('aria-checked', 'true')
  })

  it('puts the switch back when saving fails', async () => {
    vi.mocked(api.setEmailPrefs).mockRejectedValue(new Error('Server unavailable'))
    const user = userEvent.setup()
    render(wrap(<EmailPrefsForm />))

    const matches = await screen.findByRole('switch', { name: 'New matches' })
    await user.click(matches)
    await vi.waitFor(() => expect(matches).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't save that: Server unavailable")
  })

  it('asks for a confirmed address first', async () => {
    vi.mocked(api.emailPrefs).mockResolvedValue({ ...DEFAULTS, email_verified: false })
    render(wrap(<EmailPrefsForm />))
    expect(await screen.findByText(/confirm your email address first/i)).toBeInTheDocument()
  })

  it('says plainly when everything is off', async () => {
    vi.mocked(api.emailPrefs).mockResolvedValue({ ...DEFAULTS, matches: false, messages: false, dates: false })
    render(wrap(<EmailPrefsForm />))
    expect(await screen.findByRole('status')).toHaveTextContent("You won't get any emails from us")
  })
})
