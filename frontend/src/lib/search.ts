/** Helpers for showing search results: snippets around the hit and highlighted parts. */
import { useEffect, useState } from 'react'

export interface Part {
  text: string
  hit: boolean
}

/** Split `text` into plain and matching parts (case-insensitive) for <mark>ing. */
export function highlightParts(text: string, query: string): Part[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [{ text, hit: false }]
  const parts: Part[] = []
  const haystack = text.toLowerCase()
  let from = 0
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false })
    parts.push({ text: text.slice(at, at + needle.length), hit: true })
    from = at + needle.length
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false })
  return parts
}

/** A short excerpt with the first hit near the start, so it survives truncation. */
export function snippetAround(text: string, query: string, before = 28, length = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(query.trim().toLowerCase())
  if (at <= before) return flat.length > length ? `${flat.slice(0, length).trimEnd()}…` : flat
  const start = flat.lastIndexOf(' ', at - before) + 1 || at - before
  const excerpt = flat.slice(start, start + length).trim()
  return `…${excerpt}${start + length < flat.length ? '…' : ''}`
}

/** `value`, but only after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}
