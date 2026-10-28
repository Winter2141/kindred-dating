import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeClient, backoffDelay, socketUrl } from './realtime'
import type { ServerEvent } from './types'

class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeSocket[] = []

  readyState = FakeSocket.CONNECTING
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }

  close(code = 1000) {
    this.readyState = FakeSocket.CLOSED
    this.onclose?.({ code })
  }

  // Test helpers
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }

  receive(event: ServerEvent) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }

  drop(code = 1006) {
    this.readyState = FakeSocket.CLOSED
    this.onclose?.({ code })
  }
}

const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1]

function makeClient(onUnauthorized = vi.fn()) {
  return new RealtimeClient('ws://test/ws?token=t', {
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    onUnauthorized,
  })
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('backoffDelay', () => {
  it('grows exponentially and caps at 30 seconds', () => {
    const middle = () => 0.5
    expect(backoffDelay(0, middle)).toBe(500)
    expect(backoffDelay(1, middle)).toBe(1000)
    expect(backoffDelay(4, middle)).toBe(8000)
    expect(backoffDelay(20, middle)).toBe(30_000)
  })

  it('adds up to 25% jitter either way', () => {
    expect(backoffDelay(2, () => 0)).toBe(1500)
    expect(backoffDelay(2, () => 1)).toBe(2500)
  })
})

describe('socketUrl', () => {
  it('uses wss on https and escapes the token', () => {
    const location = { protocol: 'https:', host: 'kindred.app' } as Location
    expect(socketUrl('a b', location)).toBe('wss://kindred.app/ws?token=a%20b')
  })
})

describe('RealtimeClient', () => {
  it('delivers events to subscribers and reports status', () => {
    const client = makeClient()
    const statuses: string[] = []
    const events: ServerEvent[] = []
    client.onStatus((s) => statuses.push(s))
    client.subscribe((e) => events.push(e))

    client.start()
    latest().open()
    latest().receive({ type: 'pong' })

    expect(statuses).toEqual(['connecting', 'open'])
    expect(events).toEqual([{ type: 'pong' }])
  })

  it('queues chat messages while offline but drops typing events', () => {
    const client = makeClient()
    client.start()
    client.send({ type: 'message.send', match_id: 1, body: 'hi', client_id: 'c1' })
    client.send({ type: 'typing', match_id: 1, is_typing: true })
    latest().open()
    expect(latest().sent).toEqual([
      { type: 'message.send', match_id: 1, body: 'hi', client_id: 'c1' },
    ])
  })

  it('reconnects with backoff after the connection drops', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const client = makeClient()
    client.start()
    latest().open()
    latest().drop()
    expect(client.status).toBe('reconnecting')
    expect(FakeSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(500)
    expect(FakeSocket.instances).toHaveLength(2)
    latest().open()
    expect(client.status).toBe('open')
  })

  it('stops for good when the token is rejected', () => {
    const onUnauthorized = vi.fn()
    const client = makeClient(onUnauthorized)
    client.start()
    latest().drop(4401)
    vi.advanceTimersByTime(60_000)
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(FakeSocket.instances).toHaveLength(1)
    expect(client.status).toBe('idle')
  })

  it('does not reconnect after stop()', () => {
    const client = makeClient()
    client.start()
    latest().open()
    client.stop()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('pings to keep the connection alive', () => {
    const client = makeClient()
    client.start()
    latest().open()
    vi.advanceTimersByTime(25_000)
    expect(latest().sent).toContainEqual({ type: 'ping' })
    client.stop()
  })
})
