import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Message } from '@/lib/types'
import { MessageMenu, UNSEND_WINDOW_MS, canUnsend } from './MessageActions'

const now = Date.parse('2026-11-02T12:00:00Z')
const message = (overrides: Partial<Message> = {}): Message => ({
  id: 1,
  match_id: 1,
  sender_id: 7,
  body: 'see you at 8',
  created_at: new Date(now - 60_000).toISOString(),
  read_at: null,
  ...overrides,
})

describe('canUnsend', () => {
  it('allows only my own, confirmed, recent messages', () => {
    expect(canUnsend(message(), 7, now)).toBe(true)
    expect(canUnsend(message(), 8, now)).toBe(false)
    expect(canUnsend(message({ pending: 'c1' }), 7, now)).toBe(false)
    expect(canUnsend(message({ deleted_at: 'x' }), 7, now)).toBe(false)
    const old = message({ created_at: new Date(now - UNSEND_WINDOW_MS - 1).toISOString() })
    expect(canUnsend(old, 7, now)).toBe(false)
  })
})

describe('MessageMenu', () => {
  it('copies text and unsends my recent message', async () => {
    const onUnsend = vi.fn()
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const recent = message({ created_at: new Date().toISOString() })
    render(<MessageMenu message={recent} meId={7} onUnsend={onUnsend} align="right" />)

    await user.click(screen.getByRole('button', { name: 'Message options' }))
    await user.click(screen.getByRole('menuitem', { name: /copy text/i }))
    expect(writeText).toHaveBeenCalledWith('see you at 8')

    await user.click(screen.getByRole('menuitem', { name: /unsend/i }))
    expect(onUnsend).toHaveBeenCalledWith(recent)
  })

  it("doesn't offer to unsend someone else's message", async () => {
    const user = userEvent.setup()
    render(<MessageMenu message={message()} meId={8} onUnsend={vi.fn()} align="left" />)
    await user.click(screen.getByRole('button', { name: 'Message options' }))
    expect(screen.queryByRole('menuitem', { name: /unsend/i })).not.toBeInTheDocument()
  })
})
