import type { ClientEvent, ServerEvent } from './types'

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting'

const PING_EVERY_MS = 25_000
const UNAUTHORIZED = 4401

/** Exponential backoff with jitter: ~0.5s, 1s, 2s, 4s … capped at 30s. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 500 * 2 ** attempt)
  return Math.round(base * (0.75 + random() * 0.5))
}

export function socketUrl(token: string, location: Location = window.location): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${location.host}/ws?token=${encodeURIComponent(token)}`
}

interface Options {
  onUnauthorized?: () => void
  WebSocketImpl?: typeof WebSocket
}

/**
 * A WebSocket that reconnects on its own. Chat messages sent while offline are queued and
 * flushed on reconnect; typing and read events are dropped because they'd be stale.
 */
export class RealtimeClient {
  status: ConnectionStatus = 'idle'

  private socket: WebSocket | null = null
  private listeners = new Set<(event: ServerEvent) => void>()
  private statusListeners = new Set<(status: ConnectionStatus) => void>()
  private queue: ClientEvent[] = []
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private pingTimer: ReturnType<typeof setInterval> | undefined
  private stopped = true
  private readonly url: string
  private readonly options: Options

  constructor(url: string, options: Options = {}) {
    this.url = url
    this.options = options
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.open()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearInterval(this.pingTimer)
    this.socket?.close(1000)
    this.socket = null
    this.setStatus('idle')
  }

  send(event: ClientEvent): void {
    const Impl = this.options.WebSocketImpl ?? WebSocket
    if (this.socket && this.socket.readyState === Impl.OPEN) {
      this.socket.send(JSON.stringify(event))
    } else if (event.type === 'message.send') {
      this.queue.push(event)
    }
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status
    this.statusListeners.forEach((listener) => listener(status))
  }

  private open(): void {
    const Impl = this.options.WebSocketImpl ?? WebSocket
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const socket = new Impl(this.url)
    this.socket = socket

    socket.onopen = () => {
      this.attempt = 0
      this.setStatus('open')
      const pending = this.queue.splice(0)
      pending.forEach((event) => socket.send(JSON.stringify(event)))
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_EVERY_MS)
    }

    socket.onmessage = (message: MessageEvent<string>) => {
      let event: ServerEvent
      try {
        event = JSON.parse(message.data) as ServerEvent
      } catch {
        return
      }
      this.listeners.forEach((listener) => listener(event))
    }

    socket.onclose = (event: CloseEvent) => {
      clearInterval(this.pingTimer)
      if (this.socket !== socket) return
      this.socket = null
      if (event.code === UNAUTHORIZED) {
        this.stop()
        this.options.onUnauthorized?.()
        return
      }
      if (this.stopped) return
      this.setStatus('reconnecting')
      this.retryTimer = setTimeout(() => this.open(), backoffDelay(this.attempt++))
    }
  }
}
