import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CallScreen } from '@/components/CallScreen'
import { api } from './api'
import {
  bindCalls,
  describeCallRecord,
  hangUp,
  onAccepted,
  onEnded,
  onIncoming,
  onRinging,
  onSignal,
  startCall,
  useCall,
} from './calls'
import { previewText } from './photos'
import type { ClientEvent } from './types'

/** Just enough of RTCPeerConnection to follow the offer/answer dance. */
class FakePeer {
  static last: FakePeer
  remoteDescription: RTCSessionDescriptionInit | null = null
  localDescription: RTCSessionDescriptionInit | null = null
  candidates: RTCIceCandidateInit[] = []
  tracks: MediaStreamTrack[] = []
  onicecandidate: ((e: { candidate: null }) => void) | null = null
  ontrack: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  connectionState = 'new'
  closed = false
  constructor() {
    FakePeer.last = this
  }
  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track)
  }
  async createOffer() {
    return { type: 'offer', sdp: 'offer-sdp' } as RTCSessionDescriptionInit
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'answer-sdp' } as RTCSessionDescriptionInit
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d
  }
  async addIceCandidate(c: RTCIceCandidateInit) {
    this.candidates.push(c)
  }
  close() {
    this.closed = true
  }
}

const track = () => ({ stop: vi.fn(), enabled: true }) as unknown as MediaStreamTrack
const stream = () => {
  const tracks = [track(), track()]
  return { getTracks: () => tracks, getAudioTracks: () => [tracks[0]], getVideoTracks: () => [tracks[1]] } as unknown as MediaStream
}

let sent: ClientEvent[] = []
const toasts: string[] = []

beforeEach(() => {
  sent = []
  toasts.length = 0
  bindCalls((event) => sent.push(event), (title) => toasts.push(title))
  vi.stubGlobal('RTCPeerConnection', FakePeer)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream()) },
  })
  vi.spyOn(api, 'callConfig').mockResolvedValue({ ice_servers: [] })
})

afterEach(() => {
  act(() => hangUp())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const peer = { id: 9, name: 'Priya', photo: null }

describe('calling someone', () => {
  it('rings, then offers once they answer', async () => {
    await act(() => startCall(3, peer, 'video'))
    expect(sent).toEqual([{ type: 'call.invite', match_id: 3, kind: 'video' }])
    act(() => onRinging('c1', 3))
    expect(useCall.getState()).toMatchObject({ phase: 'outgoing', callId: 'c1' })

    await act(() => onAccepted('c1'))
    expect(FakePeer.last.tracks).toHaveLength(2)
    expect(sent.at(-1)).toEqual({ type: 'call.signal', call_id: 'c1', data: { description: { type: 'offer', sdp: 'offer-sdp' } } })

    // Candidates that beat the answer wait for it.
    await act(() => onSignal('c1', { candidate: { candidate: 'a' } }))
    expect(FakePeer.last.candidates).toEqual([])
    await act(() => onSignal('c1', { description: { type: 'answer', sdp: 'answer-sdp' } }))
    expect(FakePeer.last.candidates).toEqual([{ candidate: 'a' }])

    act(() => {
      FakePeer.last.connectionState = 'connected'
      FakePeer.last.onconnectionstatechange?.()
    })
    expect(useCall.getState().phase).toBe('live')
  })

  it('cleans up when they decline', async () => {
    await act(() => startCall(3, peer, 'audio'))
    act(() => onRinging('c2', 3))
    const { localStream } = useCall.getState()
    act(() => onEnded('c2', 'declined', 9, 1))
    expect(useCall.getState().phase).toBe('idle')
    localStream!.getTracks().forEach((t) => expect(t.stop).toHaveBeenCalled())
    expect(toasts).toEqual(['Declined'])
  })
})

describe('being called', () => {
  it('answers an offer', async () => {
    act(() => onIncoming('c3', 4, 'video', peer))
    render(<CallScreen />)
    expect(screen.getByText('Incoming video call')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Answer' }))
    expect(sent).toContainEqual({ type: 'call.accept', call_id: 'c3' })
    await act(() => onSignal('c3', { description: { type: 'offer', sdp: 'offer-sdp' } }))
    expect(sent.at(-1)).toEqual({ type: 'call.signal', call_id: 'c3', data: { description: { type: 'answer', sdp: 'answer-sdp' } } })
  })

  it('declines a second call while busy', () => {
    act(() => onIncoming('c4', 4, 'video', peer))
    act(() => onIncoming('c5', 5, 'audio', { id: 10, name: 'Lena', photo: null }))
    expect(sent).toEqual([{ type: 'call.end', call_id: 'c5', reason: 'declined' }])
    expect(useCall.getState().callId).toBe('c4')
  })
})

describe('call records', () => {
  it('describe themselves from each side', () => {
    expect(describeCallRecord('video', 192_000, true)).toBe('Video call · 3:12')
    expect(describeCallRecord('audio', null, false)).toBe('Missed audio call')
    expect(describeCallRecord('video', null, true)).toBe('Video call · no answer')
    expect(previewText({ body: '', call_kind: 'video', call_ms: null })).toBe('📞 Missed video call')
  })
})
