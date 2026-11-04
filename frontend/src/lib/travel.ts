/** Trips last at most this many days from today, the same limit as the server's. */
export const MAX_TRIP_DAYS = 30

const DAY = 24 * 60 * 60 * 1000

/** A day as YYYY-MM-DD in UTC, the calendar the server checks trip dates against. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
  return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY))
}

/** The earliest and latest last day a new trip can have. */
export function tripBounds(now: Date = new Date()): {
  min: string
  max: string
} {
  const today = isoDay(now)
  return { min: today, max: addDays(today, MAX_TRIP_DAYS) }
}

/** How many days are left, counting today: 1 on the last day. */
export function daysLeft(until: string, now: Date = new Date()): number {
  const diff = Date.parse(`${until}T00:00:00Z`) - Date.parse(`${isoDay(now)}T00:00:00Z`)
  return Math.max(0, Math.round(diff / DAY) + 1)
}

/** "Lisbon, Portugal" -> "Lisbon": enough for a badge. */
export function shortPlace(place: string): string {
  return place.split(',')[0].trim()
}

/** "last day today", "1 more day", "5 more days". */
export function tripRemaining(until: string, now: Date = new Date()): string {
  const left = daysLeft(until, now)
  if (left <= 1) return 'last day today'
  const more = left - 1
  return `${more} more ${more === 1 ? 'day' : 'days'}`
}

/** "Fri 14 Nov" for the end of a trip, read in UTC so it's the same day the server stored. */
export function formatTripDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}
