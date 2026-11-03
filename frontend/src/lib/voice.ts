/** Recording voice notes in the browser, and the small pure helpers around them. */
import { useCallback, useEffect, useRef, useState } from 'react'

/** Matches the server: longest note, shortest note, and bars in a stored waveform. */
export const MAX_VOICE_MS = 2 * 60 * 1000
export const MIN_VOICE_MS = 500
export const WAVEFORM_BARS = 48
/** How often the input level is sampled while recording. */
const SAMPLE_MS = 80

/** 4200 -> "0:04", 75000 -> "1:15". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Squash the levels sampled while recording into `bars` peaks between 0 and 100. */
export function toWaveform(levels: number[], bars = WAVEFORM_BARS): number[] {
  if (levels.length === 0) return Array<number>(bars).fill(0)
  const loudest = Math.max(...levels, 0.0001)
  return Array.from({ length: bars }, (_, i) => {
    const start = Math.floor((i * levels.length) / bars)
    const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / bars))
    const peak = Math.max(...levels.slice(start, end))
    // Normalise to the loudest moment so quiet speakers still get a readable shape.
    return Math.round(Math.min(100, (peak / loudest) * 100))
  })
}

/** Root-mean-square level (0-1) of one frame of time-domain samples centred on 128. */
export function rms(frame: Uint8Array): number {
  let sum = 0
  for (const sample of frame) {
    const centred = (sample - 128) / 128
    sum += centred * centred
  }
  return frame.length ? Math.sqrt(sum / frame.length) : 0
}

/** The first container this browser can record into; Safari only does MP4. */
export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(isSupported)
}

export interface Recording {
  blob: Blob
  durationMs: number
  waveform: number[]
}

export type RecorderState = 'idle' | 'starting' | 'recording' | 'unavailable'

/**
 * Microphone recording with a live level meter. `stop()` resolves with the recording;
 * `cancel()` throws it away. Recording stops by itself at MAX_VOICE_MS.
 */
export function useVoiceRecorder(onLimit?: (recording: Recording) => void) {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const session = useRef<{
    recorder: MediaRecorder
    stream: MediaStream
    context: AudioContext
    timer: ReturnType<typeof setInterval>
    startedAt: number
    chunks: Blob[]
    levels: number[]
  } | null>(null)

  const release = useCallback(() => {
    const current = session.current
    if (!current) return
    clearInterval(current.timer)
    current.stream.getTracks().forEach((track) => track.stop())
    void current.context.close().catch(() => {})
    session.current = null
  }, [])

  useEffect(() => release, [release])

  const finish = useCallback(
    (keep: boolean): Promise<Recording | null> => {
      const current = session.current
      if (!current) return Promise.resolve(null)
      const durationMs = Math.min(MAX_VOICE_MS, Date.now() - current.startedAt)
      return new Promise((resolve) => {
        current.recorder.onstop = () => {
          const blob = new Blob(current.chunks, { type: current.recorder.mimeType || 'audio/webm' })
          release()
          setState('idle')
          setElapsedMs(0)
          setLevels([])
          resolve(keep && durationMs >= MIN_VOICE_MS ? { blob, durationMs, waveform: toWaveform(current.levels) } : null)
        }
        if (current.recorder.state !== 'inactive') current.recorder.stop()
        else current.recorder.onstop?.(new Event('stop'))
      })
    },
    [release],
  )

  const onLimitRef = useRef(onLimit)
  useEffect(() => {
    onLimitRef.current = onLimit
  }, [onLimit])

  const start = useCallback(async () => {
    if (session.current || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      if (!session.current) setState('unavailable')
      return
    }
    setState('starting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setState('unavailable')
      return
    }
    const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type))
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)
    const frame = new Uint8Array(analyser.fftSize)
    const chunks: Blob[] = []
    const sampled: number[] = []
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)

    const startedAt = Date.now()
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(frame)
      sampled.push(rms(frame))
      const elapsed = Date.now() - startedAt
      setElapsedMs(elapsed)
      setLevels(sampled.slice(-32))
      if (elapsed >= MAX_VOICE_MS) {
        void finish(true).then((recording) => recording && onLimitRef.current?.(recording))
      }
    }, SAMPLE_MS)

    session.current = { recorder, stream, context, timer, startedAt, chunks, levels: sampled }
    recorder.start(250)
    setElapsedMs(0)
    setState('recording')
  }, [finish])

  return {
    state,
    elapsedMs,
    levels,
    start,
    stop: () => finish(true),
    cancel: () => void finish(false),
  }
}
