export const MAX_PHOTO_BYTES = 8 * 1024 * 1024

/** Why a picked file can't be sent, or null if it's fine. Mirrors the server's checks. */
export function photoProblem(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Pick an image file'
  if (file.size > MAX_PHOTO_BYTES) return 'Photos can be up to 8 MB'
  return null
}

/** What a chat list shows for a message: its text, or a label for a photo or voice note. */
export function previewText(message: {
  body: string
  image_url?: string | null
  audio_url?: string | null
  call_kind?: 'audio' | 'video' | null
  call_ms?: number | null
}): string {
  if (message.call_kind) {
    const kind = message.call_kind === 'video' ? 'video' : 'audio'
    return message.call_ms == null ? `📞 Missed ${kind} call` : `📞 ${kind === 'video' ? 'Video' : 'Audio'} call`
  }
  if (message.audio_url) return '🎤 Voice note'
  if (message.image_url) return message.body ? `📷 ${message.body}` : '📷 Photo'
  return message.body
}
