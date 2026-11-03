import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Switch } from '@/components/ui'
import { api } from '@/lib/api'
import type { Me, Session } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { PasswordSection } from './Settings'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, changePassword: vi.fn() } }
})

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const session = { access_token: 'fresh-token', token_type: 'bearer', user: { id: 1 } as Me } as Session

beforeEach(() => {
  vi.mocked(api.changePassword).mockReset()
  useAuth.setState({ token: 'old-token', user: null })
})

describe('PasswordSection', () => {
  it('explains what is wrong before sending anything', async () => {
    const user = userEvent.setup()
    render(wrap(<PasswordSection />))
    await user.type(screen.getByLabelText('Current password'), 'correct-horse')
    await user.type(screen.getByLabelText('New password'), 'short')
    expect(screen.getByRole('status')).toHaveTextContent('at least 8 characters')

    await user.type(screen.getByLabelText('New password'), '-but-longer')
    await user.type(screen.getByLabelText('Repeat new password'), 'something-else')
    expect(screen.getByRole('status')).toHaveTextContent("don't match")
    expect(screen.getByRole('button', { name: /update password/i })).toBeDisabled()
    expect(api.changePassword).not.toHaveBeenCalled()
  })

  it('swaps in the fresh token after a change', async () => {
    vi.mocked(api.changePassword).mockResolvedValue(session)
    const user = userEvent.setup()
    render(wrap(<PasswordSection />))
    await user.type(screen.getByLabelText('Current password'), 'correct-horse')
    await user.type(screen.getByLabelText('New password'), 'battery-staple')
    await user.type(screen.getByLabelText('Repeat new password'), 'battery-staple')
    await user.click(screen.getByRole('button', { name: /update password/i }))

    expect(api.changePassword).toHaveBeenCalledWith('correct-horse', 'battery-staple')
    await vi.waitFor(() => expect(useAuth.getState().token).toBe('fresh-token'))
    expect(screen.getByLabelText('Current password')).toHaveValue('')
  })
})

describe('Switch', () => {
  it('toggles and reports its state', async () => {
    function Harness() {
      const [on, setOn] = useState(false)
      return <Switch checked={on} onChange={setOn} label="Pause my profile" />
    }
    const user = userEvent.setup()
    render(<Harness />)
    const toggle = screen.getByRole('switch', { name: 'Pause my profile' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })
})
