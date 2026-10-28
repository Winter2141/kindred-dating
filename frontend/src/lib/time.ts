const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "now", "5m", "3h", "2d", then a short date. Used in conversation lists. */
export function shortAgo(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime()
  if (diff < MINUTE) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Presence line under a name: "Online now", "Active 12m ago", "Active yesterday". */
export function lastSeen(iso: string, online: boolean, now: Date = new Date()): string {
  if (online) return 'Online now'
  const diff = now.getTime() - new Date(iso).getTime()
  if (diff < 5 * MINUTE) return 'Active just now'
  if (diff < HOUR) return `Active ${Math.floor(diff / MINUTE)}m ago`
  if (diff < DAY) return `Active ${Math.floor(diff / HOUR)}h ago`
  if (diff < 2 * DAY) return 'Active yesterday'
  return `Active ${Math.floor(diff / DAY)}d ago`
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Divider label between messages from different days. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return new Date(iso).toLocaleDateString(undefined, { weekday: 'long' })
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}

export function isSameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b))
}

export function ageFromBirthdate(birthdate: string, today: Date = new Date()): number {
  const [year, month, day] = birthdate.split('-').map(Number)
  const hadBirthday =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day)
  return today.getFullYear() - year - (hadBirthday ? 0 : 1)
}
