import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, isMfaChallenge } from '@/lib/api'
import type { Session } from '@/lib/types'
import { LoginPage } from '@/pages/Auth'
import { useAuth } from '@/store/auth'
import { TwoFactorSettings, groupSecret } from './TwoFactor'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuth.getState().signOut()
})

const wrap = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
)

const CODES = ['abcd-efgh', 'jkmn-pqrs', 'tuvw-xyz2', '3456-789a', 'bcde-fghj', 'kmnp-qrst', 'uvwx-yz23', '4567-89ab', 'cdef-ghjk', 'mnpq-rstu']

describe('groupSecret and isMfaChallenge', () => {
  it('groups the key in fours and tells challenges from sessions', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP')
    expect(isMfaChallenge({ mfa_required: true, mfa_token: 't' })).toBe(true)
    expect(isMfaChallenge({ access_token: 'a', token_type: 'bearer', user: {} } as Session)).toBe(false)
  })
})

describe('TwoFactorSettings', () => {
  it('scans, confirms a code and shows the recovery codes once', async () => {
    vi.spyOn(api, 'twoFactorStatus').mockResolvedValue({ enabled: false, recovery_codes_left: 0 })
    vi.spyOn(api, 'startTwoFactor').mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauth_url: 'otpauth://totp/Kindred:me',
      qr_svg: '<svg viewBox="0 0 10 10"></svg>',
    })
    const enable = vi.spyOn(api, 'enableTwoFactor').mockResolvedValue({ recovery_codes: CODES })
    const user = userEvent.setup()
    render(wrap(<TwoFactorSettings />))

    await user.click(await screen.findByRole('button', { name: /turn on two-factor/i }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument()
    expect(within(dialog).getByRole('img', { name: /qr code/i })).toBeInTheDocument()

    const input = within(dialog).getByLabelText(/code from your authenticator/i)
    await user.type(input, '12a3 456')
    expect(input).toHaveValue('123456')
    await user.click(within(dialog).getByRole('button', { name: 'Turn it on' }))
    expect(enable).toHaveBeenCalledWith('123456')
    expect(await within(dialog).findByText('abcd-efgh')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /download/i })).toHaveAttribute('download', 'kindred-recovery-codes.txt')
  })

  it('shows how many recovery codes are left when it is on', async () => {
    vi.spyOn(api, 'twoFactorStatus').mockResolvedValue({ enabled: true, recovery_codes_left: 2 })
    render(wrap(<TwoFactorSettings />))
    expect(await screen.findByText(/2 recovery codes left/)).toBeInTheDocument()
    expect(screen.getByText(/make new ones before you run out/i)).toBeInTheDocument()
  })
})

describe('signing in with two-factor', () => {
  it('asks for a code after the password, or a recovery code', async () => {
    vi.spyOn(api, 'login').mockResolvedValue({ mfa_required: true, mfa_token: 'challenge' })
    const finish = vi
      .spyOn(api, 'loginWithCode')
      .mockResolvedValue({ access_token: 'session', token_type: 'bearer', user: { id: 1 } } as Session)
    const user = userEvent.setup()
    render(wrap(<LoginPage />))

    await user.type(screen.getByLabelText('Email'), 'alex@kindred.app')
    await user.type(screen.getByLabelText('Password'), 'kindred123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('One more step')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /use a recovery code/i }))
    await user.type(screen.getByLabelText('Recovery code'), 'ABCD-EFGH')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(finish).toHaveBeenCalledWith('challenge', 'abcd-efgh')
    expect(useAuth.getState().token).toBe('session')
  })
})
