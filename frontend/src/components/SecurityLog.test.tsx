import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { SecurityEvent } from '@/lib/types'
import { SecurityLog, describeEvent } from './SecurityLog'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, securityEvents: vi.fn() } }
})

const event = (overrides: Partial<SecurityEvent>): SecurityEvent => ({
  id: 1,
  kind: 'sign_in',
  device: 'Safari on iPhone',
  ip_address: '203.0.113.7',
  created_at: new Date().toISOString(),
  ...overrides,
})

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => vi.mocked(api.securityEvents).mockReset())

describe('describeEvent', () => {
  it('reads as plain English', () => {
    expect(describeEvent(event({ kind: 'two_factor_off' }))).toBe('Two-factor sign-in turned off')
    expect(describeEvent(event({ kind: 'email_changed' }))).toBe('Email address changed')
  })
})

describe('SecurityLog', () => {
  it('lists what happened, where and when', async () => {
    vi.mocked(api.securityEvents).mockResolvedValue([
      event({ id: 2, kind: 'sign_in_failed', device: 'Firefox on Windows' }),
      event({ id: 1 }),
    ])
    render(wrap(<SecurityLog />))
    const list = await screen.findByRole('list', { name: 'Recent security activity' })
    const [failed, signedIn] = within(list).getAllByRole('listitem')
    expect(failed).toHaveTextContent('Wrong password entered')
    expect(failed).toHaveTextContent('Firefox on Windows · 203.0.113.7 · just now')
    expect(signedIn).toHaveTextContent('Signed in')
  })

  it('says when there is nothing yet', async () => {
    vi.mocked(api.securityEvents).mockResolvedValue([])
    render(wrap(<SecurityLog />))
    expect(await screen.findByText('Nothing yet.')).toBeInTheDocument()
  })
})
