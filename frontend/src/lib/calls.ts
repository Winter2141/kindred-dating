/**
 * Audio and video calls with WebRTC.
 *
 * The server only rings and relays signals (see backend app/services/calls.py). Here we own
 * the RTCPeerConnection: the caller sends an offer once the call is answered, the callee
 * answers it, and both trade ICE candidates until media flows peer to peer. The state that
 * the call screen draws lives in a small store; the connection itself stays out of React.
 */
import { create } from 'zustand'
import { api } from './api'
import type { ClientEvent } from './types'

export type CallKind = 'audio' | 'video'
export type CallPhase = 'idle' | 'starting' | 'outgoing' | 'incoming' | 'connecting' | 'live'

export interface CallPeer {
  id: number
  name: string
  photo: string | null
}

interface CallState {
  phase: CallPhase
  callId: string | null
  matchId: number | null
  kind: CallKind
  peer: CallPeer | null
  /** When media started flowing, for the timer. */
  startedAt: number | null
  micOn: boolean
  cameraOn: boolean
  localStream: MediaStream | null
  remoteStream: MediaStream | null
}

const IDLE: CallState = {
  phase: 'idle',
  callId: null,
  matchId: null,
  kind: 'video',
  peer: null,
  startedAt: null,
  micOn: true,
  cameraOn: true,
  localStream: null,
  remoteStream: null,
}

export const useCall = create<CallState>()(() => ({ ...IDLE }))

type Send = (event: ClientEvent) => void
type Notify = (title: string, body?: string) => void

let send: Send = () => {}
let notify: Notify = () => {}
let peer: RTCPeerConnection | null = null
// Candidates that arrive before the remote description is set have to wait for it.
let earlyCandidates: RTCIceCandidateInit[] = []

/** The realtime provider hands us its socket and a way to show toasts. */
export function bindCalls(sender: Send, toast: Notify): void {
  send = sender
  notify = toast
}

export function inCall(): boolean {
  return useCall.getState().phase !== 'idle'
}

async function media(kind: CallKind): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
  })
}

function cleanUp(): void {
  const { localStream } = useCall.getState()
  localStream?.getTracks().forEach((track) => track.stop())
  peer?.close()
  peer = null
  earlyCandidates = []
  useCall.setState({ ...IDLE })
}

async function connect(matchId: number, callId: string, localStream: MediaStream): Promise<RTCPeerConnection> {
  const { ice_servers: iceServers } = await api.callConfig(matchId).catch(() => ({ ice_servers: [] }))
  const connection = new RTCPeerConnection({ iceServers })
  localStream.getTracks().forEach((track) => connection.addTrack(track, localStream))

  connection.onicecandidate = (e) => {
    if (e.candidate) send({ type: 'call.signal', call_id: callId, data: { candidate: e.candidate.toJSON() } })
  }
  connection.ontrack = (e) => {
    const [stream] = e.streams
    if (stream) useCall.setState({ remoteStream: stream })
  }
  connection.onconnectionstatechange = () => {
    if (connection.connectionState === 'connected' && useCall.getState().phase !== 'live') {
      useCall.setState({ phase: 'live', startedAt: Date.now() })
    } else if (connection.connectionState === 'failed') {
      notify("Call dropped", "The connection between you two couldn't be kept up.")
      hangUp('ended')
    }
  }
  peer = connection
  return connection
}

/** Ring someone. The server answers with call.ringing (or call.failed). */
export async function startCall(matchId: number, peerInfo: CallPeer, kind: CallKind): Promise<void> {
  if (inCall()) return
  useCall.setState({ ...IDLE, phase: 'starting', matchId, kind, peer: peerInfo, cameraOn: kind === 'video' })
  try {
    const localStream = await media(kind)
    // They may have cancelled while the browser asked for the camera.
    if (useCall.getState().phase !== 'starting') {
      localStream.getTracks().forEach((track) => track.stop())
      return
    }
    useCall.setState({ localStream })
    send({ type: 'call.invite', match_id: matchId, kind })
  } catch {
    cleanUp()
    notify("Can't start the call", `Allow ${kind === 'video' ? 'camera and microphone' : 'microphone'} access to call.`)
  }
}

export function onRinging(callId: string, matchId: number): void {
  const state = useCall.getState()
  if (state.phase === 'starting' && state.matchId === matchId) useCall.setState({ phase: 'outgoing', callId })
}

export function onIncoming(callId: string, matchId: number, kind: CallKind, from: CallPeer): void {
  if (inCall()) {
    send({ type: 'call.end', call_id: callId, reason: 'declined' })
    return
  }
  useCall.setState({ ...IDLE, phase: 'incoming', callId, matchId, kind, peer: from, cameraOn: kind === 'video' })
}

export async function acceptCall(): Promise<void> {
  const { phase, callId, matchId, kind } = useCall.getState()
  if (phase !== 'incoming' || !callId || !matchId) return
  try {
    const localStream = await media(kind)
    useCall.setState({ localStream, phase: 'connecting' })
    await connect(matchId, callId, localStream)
    send({ type: 'call.accept', call_id: callId })
  } catch {
    hangUp('declined')
    notify("Can't answer", `Allow ${kind === 'video' ? 'camera and microphone' : 'microphone'} access to take calls.`)
  }
}

/** The callee picked up: the caller makes the offer. */
export async function onAccepted(callId: string): Promise<void> {
  const { callId: current, matchId, localStream } = useCall.getState()
  if (callId !== current || !matchId || !localStream) return
  useCall.setState({ phase: 'connecting' })
  const connection = await connect(matchId, callId, localStream)
  const offer = await connection.createOffer()
  await connection.setLocalDescription(offer)
  send({ type: 'call.signal', call_id: callId, data: { description: offer } })
}

export async function onSignal(callId: string, data: Record<string, unknown>): Promise<void> {
  if (callId !== useCall.getState().callId || !peer) return
  const connection = peer
  if (data.description) {
    const description = data.description as RTCSessionDescriptionInit
    await connection.setRemoteDescription(description)
    for (const candidate of earlyCandidates.splice(0)) await connection.addIceCandidate(candidate)
    if (description.type === 'offer') {
      const answer = await connection.createAnswer()
      await connection.setLocalDescription(answer)
      send({ type: 'call.signal', call_id: callId, data: { description: answer } })
    }
  } else if (data.candidate) {
    const candidate = data.candidate as RTCIceCandidateInit
    if (connection.remoteDescription) await connection.addIceCandidate(candidate)
    else earlyCandidates.push(candidate)
  }
}

/** Leave the call: cancel while ringing, decline while being rung, or hang up. */
export function hangUp(reason: 'ended' | 'declined' | 'cancelled' = 'ended'): void {
  const { callId } = useCall.getState()
  if (callId) send({ type: 'call.end', call_id: callId, reason })
  cleanUp()
}

const ENDED_MESSAGES: Record<string, string> = {
  declined: 'Declined',
  missed: 'No answer',
}

export function onEnded(callId: string, reason: string, by: number | null, meId: number | undefined): void {
  const { callId: current, peer: who } = useCall.getState()
  if (callId !== current) return
  cleanUp()
  if (by !== meId && reason in ENDED_MESSAGES) notify(ENDED_MESSAGES[reason], who ? `${who.name} couldn't take the call.` : undefined)
}

export function onFailed(detail: string): void {
  if (useCall.getState().phase === 'idle') return
  cleanUp()
  notify("Couldn't call", detail)
}

export function toggleMic(): void {
  const { localStream, micOn } = useCall.getState()
  localStream?.getAudioTracks().forEach((track) => (track.enabled = !micOn))
  useCall.setState({ micOn: !micOn })
}

export function toggleCamera(): void {
  const { localStream, cameraOn } = useCall.getState()
  localStream?.getVideoTracks().forEach((track) => (track.enabled = !cameraOn))
  useCall.setState({ cameraOn: !cameraOn })
}

/** "Video call · 3:12", "Missed audio call" or "No answer", for the record left in the chat. */
export function describeCallRecord(kind: CallKind, ms: number | null, iCalled: boolean): string {
  if (ms === null) return iCalled ? `${kind === 'video' ? 'Video' : 'Audio'} call · no answer` : `Missed ${kind} call`
  const total = Math.round(ms / 1000)
  const length = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  return `${kind === 'video' ? 'Video' : 'Audio'} call · ${length}`
}
