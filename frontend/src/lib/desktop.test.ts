import { afterEach, describe, expect, it, vi } from 'vitest'
import { NAVIGATE_EVENT, desktopPermission, notifyDesktop, titleWithCount } from './desktop'

class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static shown: FakeNotification[] = []
  onclick: (() => void) | null = null
  closed = false

  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    FakeNotification.shown.push(this)
  }

  close() {
    this.closed = true
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeNotification.shown = []
  FakeNotification.permission = 'granted'
})

describe('titleWithCount', () => {
  it('prefixes the unread count', () => {
    expect(titleWithCount(0)).toBe('Kindred — find your person')
    expect(titleWithCount(3)).toBe('(3) Kindred — find your person')
    expect(titleWithCount(250, 'Kindred')).toBe('(99+) Kindred')
  })
})

describe('notifyDesktop', () => {
  const alert = { title: 'Maya', body: 'Testing a recipe', href: '/app/matches/1', tag: 'match-1' }

  it('only notifies when enabled, permitted and in the background', () => {
    vi.stubGlobal('Notification', FakeNotification)
    expect(notifyDesktop(alert, { enabled: false, hidden: true })).toBe(false)
    expect(notifyDesktop(alert, { enabled: true, hidden: false })).toBe(false)
    FakeNotification.permission = 'denied'
    expect(notifyDesktop(alert, { enabled: true, hidden: true })).toBe(false)
    expect(FakeNotification.shown).toHaveLength(0)

    FakeNotification.permission = 'granted'
    expect(notifyDesktop(alert, { enabled: true, hidden: true })).toBe(true)
    expect(FakeNotification.shown[0].title).toBe('Maya')
    expect(FakeNotification.shown[0].options).toMatchObject({ body: 'Testing a recipe', tag: 'match-1' })
  })

  it('focuses the app and navigates when clicked', () => {
    vi.stubGlobal('Notification', FakeNotification)
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const navigated = vi.fn()
    window.addEventListener(NAVIGATE_EVENT, (e) => navigated((e as CustomEvent).detail))

    notifyDesktop(alert, { enabled: true, hidden: true })
    FakeNotification.shown[0].onclick?.()
    expect(focus).toHaveBeenCalled()
    expect(navigated).toHaveBeenCalledWith('/app/matches/1')
    expect(FakeNotification.shown[0].closed).toBe(true)
  })

  it('reports browsers without notifications', () => {
    vi.stubGlobal('Notification', undefined)
    expect(desktopPermission()).toBe('unsupported')
    expect(notifyDesktop(alert, { enabled: true, hidden: true })).toBe(false)
  })
})
