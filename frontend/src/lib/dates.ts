import type { DateProposal } from './types'

/** Insert or replace a proposal in a chat's list, keeping creation order. */
export function upsertDate(list: DateProposal[] | undefined, date: DateProposal): DateProposal[] | undefined {
  if (!list) return list
  const rest = list.filter((d) => d.id !== date.id)
  return [...rest, date].sort((a, b) => a.id - b.id)
}

/** The proposal worth showing at the top of a chat: one waiting for an answer, or a date still to come. */
export function activeDate(list: DateProposal[] | undefined, now: Date = new Date()): DateProposal | null {
  const latest = list?.[list.length - 1]
  if (!latest) return null
  if (latest.status === 'proposed') return latest
  if (latest.status === 'accepted' && new Date(latest.starts_at) > now) return latest
  return null
}

export function formatDateTime(iso: string): string {
  const when = new Date(iso)
  const day = when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}

/** Value for <input type="datetime-local"> in the viewer's time zone. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A sensible default: tomorrow at 7pm. */
export function defaultDateTime(now: Date = new Date()): string {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 19, 0)
  return toLocalInput(tomorrow)
}

function icsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
}

/** An iCalendar file for an accepted date, two hours long. */
export function buildIcs(date: DateProposal, withName: string, now: Date = new Date()): string {
  const start = new Date(date.starts_at)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kindred//Dates//EN',
    'BEGIN:VEVENT',
    `UID:kindred-date-${date.id}@kindred.app`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(`Date with ${withName}`)}`,
    `LOCATION:${icsText(date.place)}`,
    ...(date.note ? [`DESCRIPTION:${icsText(date.note)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}
