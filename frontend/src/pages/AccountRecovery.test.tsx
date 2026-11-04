import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailBanner } from '@/components/EmailBanner'
import { api } from '@/lib/api'
import type { Me, Session } from '@/lib/types'
import { useAuth } from '@/store/auth'
import {
  ConfirmEmailChangePage,
  ForgotPasswordPage,
  ResetPasswordPage,
  UnsubscribePage,
  VerifyEmailPage,
} from './AccountRecovery'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuth.getState().signOut()
})

function renderAt(path: string, element: ReactNode, route: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
          <Route path="/app/discover" element={<p>Discover</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ForgotPasswordPage', () => {
  it('asks for a link and says to check the inbox', async () => {
    const ask = vi.spyOn(api, 'forgotPassword').mockResolvedValue()
    const user = userEvent.setup()
    renderAt('/forgot-password', <ForgotPasswordPage />, '/forgot-password')
    await user.type(screen.getByLabelText('Email'), 'maya@kindred.app')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))
    expect(ask).toHaveBeenCalledWith('maya@kindred.app')
    expect(await screen.findByText('Check your inbox')).toBeInTheDocument()
  })
})

describe('ResetPasswordPage', () => {
  it('checks both passwords match, then signs in', async () => {
    const session = { access_token: 't', token_type: 'bearer', user: { id: 1, email: 'm@x.com' } } as Session
    const reset = vi.spyOn(api, 'resetPassword').mockResolvedValue(session)
    const user = userEvent.setup()
    renderAt('/reset-password?token=abc', <ResetPasswordPage />, '/reset-password')

    await user.type(screen.getByLabelText('New password'), 'new-password-1')
    await user.type(screen.getByLabelText('Type it again'), 'new-password-2')
    expect(screen.getByText("Those don't match yet.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save and sign in/i })).toBeDisabled()

    await user.clear(screen.getByLabelText('Type it again'))
    await user.type(screen.getByLabelText('Type it again'), 'new-password-1')
    await user.click(screen.getByRole('button', { name: /save and sign in/i }))
    expect(reset).toHaveBeenCalledWith('abc', 'new-password-1')
    expect(await screen.findByText('Discover')).toBeInTheDocument()
    expect(useAuth.getState().token).toBe('t')
  })

  it('explains a missing token', () => {
    renderAt('/reset-password', <ResetPasswordPage />, '/reset-password')
    expect(screen.getByText(/needs the link from your email/i)).toBeInTheDocument()
  })
})

describe('VerifyEmailPage', () => {
  it('confirms the email from the link once', async () => {
    const verify = vi.spyOn(api, 'verifyEmail').mockResolvedValue({ email: 'maya@kindred.app', verified: true })
    renderAt('/verify-email?token=xyz', <VerifyEmailPage />, '/verify-email')
    expect(await screen.findByText('Email confirmed')).toBeInTheDocument()
    expect(verify).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledWith('xyz')
  })

  it('says when the link is bad', async () => {
    vi.spyOn(api, 'verifyEmail').mockRejectedValue(new Error('expired'))
    renderAt('/verify-email?token=old', <VerifyEmailPage />, '/verify-email')
    expect(await screen.findByText("That link didn't work")).toBeInTheDocument()
  })
})

describe('EmailBanner', () => {
  it('shows until the email is confirmed and can resend', async () => {
    const resend = vi.spyOn(api, 'resendVerification').mockResolvedValue()
    useAuth.getState().setUser({ id: 1, email: 'new@x.com', email_verified: false } as Me)
    const user = userEvent.setup()
    render(<QueryClientProvider client={new QueryClient()}><EmailBanner /></QueryClientProvider>)
    expect(screen.getByText(/confirm your email/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resend' }))
    expect(resend).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Sent' })).toBeDisabled()

    act(() => useAuth.getState().setUser({ id: 1, email: 'new@x.com', email_verified: true } as Me))
    expect(screen.queryByText(/confirm your email/i)).not.toBeInTheDocument()
  })
})

describe('UnsubscribePage', () => {
  it('waits for a click, so mail scanners opening the link change nothing', async () => {
    const stop = vi.spyOn(api, 'unsubscribe').mockResolvedValue()
    const user = userEvent.setup()
    renderAt('/unsubscribe?token=abc', <UnsubscribePage />, '/unsubscribe')
    expect(screen.getByRole('heading', { name: 'Stop Kindred emails?' })).toBeInTheDocument()
    expect(stop).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    expect(stop).toHaveBeenCalledWith('abc')
    expect(await screen.findByRole('heading', { name: "You're unsubscribed" })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  it('explains a bad or missing link', async () => {
    vi.spyOn(api, 'unsubscribe').mockRejectedValue(new Error('That link is invalid or has expired'))
    const user = userEvent.setup()
    renderAt('/unsubscribe?token=old', <UnsubscribePage />, '/unsubscribe')
    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    expect(await screen.findByRole('heading', { name: "That link didn't work" })).toBeInTheDocument()

    cleanup()
    renderAt('/unsubscribe', <UnsubscribePage />, '/unsubscribe')
    expect(screen.getByRole('heading', { name: "That link didn't work" })).toBeInTheDocument()
  })

  it('sends signed-in people back to their email settings', async () => {
    useAuth.setState({ token: 'token', user: { id: 1 } as Me })
    vi.spyOn(api, 'unsubscribe').mockResolvedValue()
    const user = userEvent.setup()
    renderAt('/unsubscribe?token=abc', <UnsubscribePage />, '/unsubscribe')
    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    expect(await screen.findByRole('link', { name: 'Open email settings' })).toHaveAttribute(
      'href',
      '/app/settings#email',
    )
  })
})

describe('ConfirmEmailChangePage', () => {
  it('confirms the new address once on arrival', async () => {
    const confirm = vi.spyOn(api, 'confirmEmailChange').mockResolvedValue({ email: 'maya@new.example', verified: true })
    renderAt('/confirm-email-change?token=abc', <ConfirmEmailChangePage />, '/confirm-email-change')
    expect(await screen.findByText('New email confirmed')).toBeInTheDocument()
    expect(screen.getByText('From now on, sign in with maya@new.example.')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledWith('abc')
  })

  it('explains a link that no longer works', async () => {
    vi.spyOn(api, 'confirmEmailChange').mockRejectedValue(new Error('That link is invalid, expired or replaced by a newer one'))
    renderAt('/confirm-email-change?token=old', <ConfirmEmailChangePage />, '/confirm-email-change')
    expect(await screen.findByText("That link didn't work")).toBeInTheDocument()
    expect(screen.getByText(/replaced by a newer one\. Your email hasn't changed/)).toBeInTheDocument()
  })
})
