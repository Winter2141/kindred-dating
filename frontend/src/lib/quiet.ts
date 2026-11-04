/** Quiet hours: a nightly window when nothing should buzz, in the person's own time zone. */

export interface QuietHours {
  /** Hours 0–23. The window can wrap past midnight (22 → 8). */
  start: number
  end: number
  /** An IANA zone like "America/New_York". */
  timezone: string
}

export const DEFAULT_QUIET: Omit<QuietHours, 'timezone'> = { start: 22, end: 8 }

/** The browser's time zone, falling back to UTC where it can't say. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** The hour (0–23) it is right now in `timezone`. */
export function hourIn(timezone: string, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(now)
  return Number(hour) % 24
}

/** Whether `hour` falls inside [start, end), wrapping past midnight when start > end. */
export function inWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return false
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

export function isQuietNow(quiet: QuietHours | null | undefined, now: Date = new Date()): boolean {
  if (!quiet) return false
  try {
    return inWindow(hourIn(quiet.timezone, now), quiet.start, quiet.end)
  } catch {
    return false // an unknown zone shouldn't silence everything
  }
}

/** 0 → "12 am", 13 → "1 pm". */
export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`
}

/** "10 pm to 8 am (8 hours)". */
export function quietSummary({ start, end }: Pick<QuietHours, 'start' | 'end'>): string {
  const hours = (end - start + 24) % 24
  return `${hourLabel(start)} to ${hourLabel(end)} (${hours} ${hours === 1 ? 'hour' : 'hours'})`
}
