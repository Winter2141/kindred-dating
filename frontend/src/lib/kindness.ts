/**
 * The "Are you sure?" check before a message goes out. The patterns come from the server
 * (GET /api/meta, built in backend/app/kindness.py), so both sides agree on what counts.
 */

// Digits and symbols people swap in for letters. Keep in step with _LOOKALIKES on the server.
const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
  '’': "'",
  '‘': "'",
}

export function normalise(text: string): string {
  return Array.from(text.toLowerCase(), (ch) => LOOKALIKES[ch] ?? ch).join('')
}

const compiled = new Map<string, RegExp>()

function pattern(source: string): RegExp | null {
  let regex = compiled.get(source)
  if (!regex) {
    try {
      regex = new RegExp(source, 'gi')
    } catch {
      return null // an engine difference shouldn't break sending
    }
    compiled.set(source, regex)
  }
  return regex
}

/** The phrases in `text` that read as insults, in the order they appear. */
export function unkindPhrases(text: string, patterns: readonly string[]): string[] {
  if (!text.trim() || patterns.length === 0) return []
  const plain = normalise(text)
  const found: [number, string][] = []
  for (const source of patterns) {
    const regex = pattern(source)
    if (!regex) continue
    for (const match of plain.matchAll(regex)) found.push([match.index, match[0].trim()])
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, phrase]) => phrase)
}
