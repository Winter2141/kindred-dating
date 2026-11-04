import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { keys } from '@/lib/cache'
import type { Meta } from '@/lib/types'
import { KindnessNudge, useKindnessCheck } from './Kindness'

function withMeta(meta: Partial<Meta> | null) {
  const client = new QueryClient()
  if (meta) client.setQueryData(keys.meta, meta)
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useKindnessCheck', () => {
  it('uses the patterns the server sent', () => {
    const { result } = renderHook(() => useKindnessCheck(), {
      wrapper: withMeta({ unkind_patterns: [String.raw`\bl+o+s+e+r+\b`] }),
    })
    expect(result.current('such a LOSER')).toEqual(['loser'])
    expect(result.current('see you at 8')).toEqual([])
  })

  it('lets everything through until they have loaded', () => {
    const { result } = renderHook(() => useKindnessCheck(), { wrapper: withMeta({}) })
    expect(result.current('loser')).toEqual([])
  })
})

describe('KindnessNudge', () => {
  it('quotes what looked unkind and offers both ways out', async () => {
    const onEdit = vi.fn()
    const onSendAnyway = vi.fn()
    const user = userEvent.setup()
    render(
      <KindnessNudge phrases={['loser', 'loser', 'shut up']} name="Maya" onEdit={onEdit} onSendAnyway={onSendAnyway} />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Are you sure?' })
    expect(dialog).toHaveTextContent('"loser", "shut up" might hurt. Maya is a real person')
    expect(screen.getByRole('button', { name: /edit message/i })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: /send anyway/i }))
    expect(onSendAnyway).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: /edit message/i }))
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('stays closed with nothing to say', () => {
    render(<KindnessNudge phrases={[]} name="Maya" onEdit={vi.fn()} onSendAnyway={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
