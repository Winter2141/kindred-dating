import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { PublicProfile } from '@/lib/types'
import { ReportDialog } from './Safety'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, report: vi.fn() } }
})

const robin = { id: 7, name: 'Robin', photos: [] } as unknown as PublicProfile

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => vi.mocked(api.report).mockReset())

describe('ReportDialog', () => {
  it('needs a reason, then reports and blocks by default', async () => {
    vi.mocked(api.report).mockResolvedValue({ id: 1 })
    const onReported = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(wrap(<ReportDialog person={robin} open onClose={onClose} onReported={onReported} />))

    const send = screen.getByRole('button', { name: /send report/i })
    expect(send).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /harassment/i }))
    await user.type(screen.getByLabelText(/anything else/i), 'kept messaging after I said no')
    await user.click(send)

    expect(api.report).toHaveBeenCalledWith({
      user_id: 7,
      reason: 'harassment',
      details: 'kept messaging after I said no',
      block: true,
    })
    await vi.waitFor(() => expect(onReported).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })

  it('can report without blocking', async () => {
    vi.mocked(api.report).mockResolvedValue({ id: 2 })
    const onReported = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(wrap(<ReportDialog person={robin} open onClose={onClose} onReported={onReported} />))

    await user.click(screen.getByRole('radio', { name: /spam/i }))
    await user.click(screen.getByRole('checkbox', { name: /also block robin/i }))
    await user.click(screen.getByRole('button', { name: /send report/i }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(api.report).mock.calls[0][0].block).toBe(false)
    expect(onReported).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(wrap(<ReportDialog person={robin} open onClose={onClose} onReported={vi.fn()} />))
    expect(screen.getByRole('dialog', { name: 'Report Robin' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
