import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { Me } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { EmailAddressForm, looksLikeEmail } from './EmailAddress'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, changeEmail: vi.fn(), resendEmailChange: vi.fn(), cancelEmailChange: vi.fn() },
  }
})

const ME = { id: 1, name: 'Maya', email: 'maya@kindred.app', email_verified: true, pending_email: null } as Me

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Renders the form for whoever the auth store holds, re-rendering as it changes. */
function Live() {
  const user = useAuth((s) => s.user)
  return user ? <EmailAddressForm user={user} /> : null
}

beforeEach(() => {
  useAuth.getState().setUser(ME)
  vi.mocked(api.changeEmail).mockReset()
  vi.mocked(api.resendEmailChange).mockReset()
  vi.mocked(api.cancelEmailChange).mockReset()
})

afterEach(() => useAuth.getState().signOut())

describe('looksLikeEmail', () => {
  it('catches obvious typos', () => {
    expect(looksLikeEmail('maya@kindred.app')).toBe(true)
    expect(looksLikeEmail(' maya@kindred.app ')).toBe(true)
    expect(looksLikeEmail('maya@kindred')).toBe(false)
    expect(looksLikeEmail('maya kindred.app')).toBe(false)
    expect(looksLikeEmail('@kindred.app')).toBe(false)
  })
})

describe('EmailAddressForm', () => {
  it('shows the current address and whether it is confirmed', () => {
    render(wrap(<EmailAddressForm user={{ ...ME, email_verified: false }} />))
    expect(screen.getByText('maya@kindred.app')).toBeInTheDocument()
    expect(screen.getByText('Not confirmed yet')).toBeInTheDocument()
  })

  it('asks for a new address and then shows it waiting', async () => {
    vi.mocked(api.changeEmail).mockResolvedValue({ ...ME, pending_email: 'maya@new.example' })
    const user = userEvent.setup()
    render(wrap(<Live />))

    await user.click(screen.getByRole('button', { name: 'Change email' }))
    const send = screen.getByRole('button', { name: /send confirmation link/i })
    await user.type(screen.getByLabelText('New email'), 'MAYA@kindred.app')
    await user.type(screen.getByLabelText('Your password'), 'correct-horse')
    expect(screen.getByRole('status')).toHaveTextContent("That's the address you already use.")
    expect(send).toBeDisabled()

    await user.clear(screen.getByLabelText('New email'))
    await user.type(screen.getByLabelText('New email'), 'maya@new.example')
    await user.click(send)
    expect(api.changeEmail).toHaveBeenCalledWith('maya@new.example', 'correct-horse')
    expect(await screen.findByText('maya@new.example')).toBeInTheDocument()
    expect(screen.getByText(/Waiting for you to confirm/)).toBeInTheDocument()
  })

  it('shows what the server said when the change is refused', async () => {
    vi.mocked(api.changeEmail).mockRejectedValue(new Error('Another account already uses that email'))
    const user = userEvent.setup()
    render(wrap(<Live />))
    await user.click(screen.getByRole('button', { name: 'Change email' }))
    await user.type(screen.getByLabelText('New email'), 'taken@example.com')
    await user.type(screen.getByLabelText('Your password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: /send confirmation link/i }))
    expect(await screen.findByText('Another account already uses that email')).toBeInTheDocument()
  })

  it('resends or cancels a waiting change', async () => {
    useAuth.getState().setUser({ ...ME, pending_email: 'maya@new.example' })
    vi.mocked(api.resendEmailChange).mockResolvedValue()
    vi.mocked(api.cancelEmailChange).mockResolvedValue(ME)
    const user = userEvent.setup()
    render(wrap(<Live />))

    await user.click(screen.getByRole('button', { name: /send the link again/i }))
    expect(api.resendEmailChange).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: /keep my current email/i }))
    expect(await screen.findByRole('button', { name: 'Change email' })).toBeInTheDocument()
    expect(screen.queryByText(/Waiting for you to confirm/)).not.toBeInTheDocument()
  })
})
