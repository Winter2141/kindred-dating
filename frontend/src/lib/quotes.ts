/** Pure helpers for quoted messages (replies), shared by the chat UI and the cache. */
import type { Message, QuotedMessage } from './types'

/** Matches the server's trim so an optimistic quote looks like the one that comes back. */
export const QUOTE_LENGTH = 160

export function trimQuote(body: string): string {
  return body.length <= QUOTE_LENGTH ? body : `${body.slice(0, QUOTE_LENGTH - 1).trimEnd()}…`
}

export function quoteOf(message: Message): QuotedMessage {
  return {
    id: message.id,
    sender_id: message.sender_id,
    body: trimQuote(message.body),
    image_url: message.image_url ?? null,
    audio_url: message.audio_url ?? null,
    deleted_at: message.deleted_at ?? null,
  }
}

/** One line describing what a quote contains. */
export function quoteText(quote: QuotedMessage): string {
  if (quote.deleted_at) return 'Message unsent'
  if (quote.audio_url) return '🎤 Voice note'
  if (quote.image_url) return quote.body ? `📷 ${quote.body}` : '📷 Photo'
  return quote.body
}

export function quoteAuthor(quote: QuotedMessage, meId: number, otherName: string): string {
  return quote.sender_id === meId ? 'You' : otherName
}
