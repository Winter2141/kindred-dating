/** Browser-level attention: an unread count in the tab title and system notifications. */

export const BASE_TITLE = 'Kindred — find your person'
export const NAVIGATE_EVENT = 'kindred:navigate'

export function titleWithCount(count: number, base = BASE_TITLE): string {
  if (count <= 0) return base
  return `(${count > 99 ? '99+' : count}) ${base}`
}

export type DesktopPermission = NotificationPermission | 'unsupported'

export function desktopPermission(): DesktopPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.requestPermission()
}

/**
 * Show a system notification when the tab is in the background. Clicking it focuses the tab
 * and asks the app to navigate (the router listens for NAVIGATE_EVENT).
 * Returns whether a notification was shown.
 */
export function notifyDesktop(
  { title, body, icon, href, tag }: { title: string; body?: string; icon?: string; href?: string; tag?: string },
  { enabled, hidden = document.visibilityState === 'hidden' }: { enabled: boolean; hidden?: boolean },
): boolean {
  if (!enabled || !hidden || desktopPermission() !== 'granted') return false
  const notification = new Notification(title, { body, icon, tag })
  notification.onclick = () => {
    window.focus()
    if (href) window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: href }))
    notification.close()
  }
  return true
}
