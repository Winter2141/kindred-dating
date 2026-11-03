import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { applyUnsend } from '@/lib/cache'
import type { Message, QuotedMessage } from '@/lib/types'
import { QUOTE_LENGTH, QuoteBlock, ReplyBanner, quoteAuthor, quoteOf, quoteText } from './Replies'

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 5,
  match_id: 1,
  sender_id: 7,
  body: 'Mountains or the sea?',
  created_at: '2026-11-03T10:00:00Z',
  read_at: null,
  ...overrides,
})

const quote = (overrides: Partial<QuotedMessage> = {}): QuotedMessage => ({
  id: 5,
  sender_id: 7,
  body: 'Mountains or the sea?',
  image_url: null,
  deleted_at: null,
  ...overrides,
})

describe('quoteOf', () => {
  it('keeps short messages whole', () => {
    expect(quoteOf(message())).toEqual(quote())
  })

  it('trims long messages the way the server does', () => {
    const long = quoteOf(message({ body: 'word '.repeat(100) }))
    expect(long.body.length).toBeLessThanOrEqual(QUOTE_LENGTH)
    expect(long.body.endsWith('…')).toBe(true)
  })
})

describe('quoteText and quoteAuthor', () => {
  it('describes photos and unsent messages', () => {
    expect(quoteText(quote({ image_url: '/media/a.jpg', body: '' }))).toBe('📷 Photo')
    expect(quoteText(quote({ image_url: '/media/a.jpg', body: 'Biscuit' }))).toBe('📷 Biscuit')
    expect(quoteText(quote({ deleted_at: '2026-11-03T10:01:00Z', body: '' }))).toBe('Message unsent')
  })

  it('names you or them', () => {
    expect(quoteAuthor(quote(), 7, 'Maya')).toBe('You')
    expect(quoteAuthor(quote(), 8, 'Maya')).toBe('Maya')
  })
})

describe('QuoteBlock', () => {
  it('jumps to the original when clicked', async () => {
    const onJump = vi.fn()
    render(<QuoteBlock quote={quote()} meId={8} otherName="Maya" mine onJump={onJump} />)
    await userEvent.click(screen.getByRole('button', { name: /replying to maya/i }))
    expect(onJump).toHaveBeenCalledWith(5)
  })
})

describe('ReplyBanner', () => {
  it('shows who you are answering and can be cancelled', async () => {
    const onCancel = vi.fn()
    render(<ReplyBanner quote={quote()} meId={8} otherName="Maya" onCancel={onCancel} />)
    expect(screen.getByText('Replying to Maya')).toBeInTheDocument()
    expect(screen.getByText('Mountains or the sea?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel reply' }))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('applyUnsend', () => {
  it('blanks quotes of the unsent message too', () => {
    const original = message()
    const reply = message({ id: 6, sender_id: 8, body: 'Mountains', reply_to: quote() })
    const [gone, answered] = applyUnsend([original, reply], 5, '2026-11-03T10:02:00Z')!
    expect(gone.deleted_at).toBe('2026-11-03T10:02:00Z')
    expect(answered.body).toBe('Mountains')
    expect(answered.reply_to).toMatchObject({ body: '', deleted_at: '2026-11-03T10:02:00Z' })
  })
})
