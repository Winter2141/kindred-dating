import clsx from 'clsx'
import { Mic, Pause, Play, SendHorizontal, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { MAX_VOICE_MS, WAVEFORM_BARS, formatDuration } from '@/lib/voice'

/** A voice note inside a chat bubble: play/pause, a seekable waveform and the time. */
export function VoicePlayer({
  src,
  durationMs,
  waveform,
  mine,
}: {
  src: string
  durationMs: number
  waveform: number[] | null | undefined
  mine: boolean
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const bars = waveform?.length ? waveform : Array<number>(WAVEFORM_BARS).fill(30)
  const progress = durationMs ? Math.min(1, position / durationMs) : 0

  useEffect(() => {
    const el = audio.current
    if (!el) return
    const onTime = () => setPosition(el.currentTime * 1000)
    const onEnd = () => {
      setPlaying(false)
      setPosition(0)
    }
    const onPause = () => setPlaying(false)
    const onPlay = () => {
      setPlaying(true)
      // Only one voice note plays at a time, like any messaging app.
      document.querySelectorAll('audio').forEach((other) => other !== el && other.pause())
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('ended', onEnd)
    el.addEventListener('pause', onPause)
    el.addEventListener('play', onPlay)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('ended', onEnd)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('play', onPlay)
    }
  }, [])

  const toggle = () => {
    const el = audio.current
    if (!el) return
    if (el.paused) void el.play().catch(() => setPlaying(false))
    else el.pause()
  }

  const seekTo = (fraction: number) => {
    const el = audio.current
    if (!el) return
    el.currentTime = (Math.max(0, Math.min(1, fraction)) * durationMs) / 1000
    setPosition(el.currentTime * 1000)
  }

  const onSeekKey = (e: KeyboardEvent) => {
    const step = 5000 / Math.max(durationMs, 1)
    if (e.key === 'ArrowRight') seekTo(progress + step)
    else if (e.key === 'ArrowLeft') seekTo(progress - step)
    else return
    e.preventDefault()
  }

  return (
    <div className="flex w-64 max-w-full items-center gap-3 py-0.5">
      <audio ref={audio} src={src} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        className={clsx(
          'grid size-10 shrink-0 place-items-center rounded-full transition',
          mine ? 'bg-ink/20 text-ink hover:bg-ink/30' : 'bg-gradient-brand text-ink hover:brightness-110',
        )}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
      >
        {playing ? <Pause className="size-4.5" /> : <Play className="ml-0.5 size-4.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          role="slider"
          tabIndex={0}
          aria-label="Voice note position"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs / 1000)}
          aria-valuenow={Math.round(position / 1000)}
          aria-valuetext={`${formatDuration(position)} of ${formatDuration(durationMs)}`}
          onKeyDown={onSeekKey}
          onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
            const box = e.currentTarget.getBoundingClientRect()
            seekTo((e.clientX - box.left) / box.width)
          }}
          className="flex h-8 cursor-pointer items-center gap-[2px]"
        >
          {bars.map((level, i) => {
            const played = (i + 0.5) / bars.length <= progress
            return (
              <span
                key={i}
                className={clsx(
                  'w-[3px] flex-1 rounded-full transition-colors',
                  mine ? (played ? 'bg-ink' : 'bg-ink/35') : played ? 'bg-coral' : 'bg-cream/25',
                )}
                style={{ height: `${Math.max(12, level)}%` }}
              />
            )
          })}
        </div>
        <p className={clsx('mt-0.5 text-[11px] tabular-nums', mine ? 'text-ink/70' : 'text-faint')}>
          {playing || position > 0 ? formatDuration(position) : formatDuration(durationMs)}
        </p>
      </div>
    </div>
  )
}

/** The mic button in the composer, shown while there's nothing typed. */
export function RecordButton({ onStart, disabled }: { onStart: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onStart}
      disabled={disabled}
      className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-ink shadow-glow transition hover:brightness-110 disabled:opacity-60"
      aria-label="Record a voice note"
      title="Record a voice note"
    >
      <Mic className="size-5" />
    </button>
  )
}

/** Speech RMS mostly sits between 0.02 and 0.3; a square root spreads that over the bar. */
export function meterHeight(level: number): number {
  return Math.round(Math.max(10, Math.min(100, Math.sqrt(Math.max(0, level)) * 165)))
}

/** Replaces the composer while recording: a live level meter, the time, cancel and send. */
export function RecordingBar({
  elapsedMs,
  levels,
  onCancel,
  onSend,
}: {
  elapsedMs: number
  levels: number[]
  onCancel: () => void
  onSend: () => void
}) {
  const recent = [...Array<number>(Math.max(0, 32 - levels.length)).fill(0), ...levels]
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-3xl items-center gap-3 rounded-[1.6rem] border border-coral/40 bg-raised/70 p-1.5 pl-2"
      role="group"
      aria-label="Recording a voice note"
    >
      <button
        type="button"
        onClick={onCancel}
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface hover:text-danger"
        aria-label="Discard recording"
        title="Discard"
      >
        <Trash2 className="size-5" />
      </button>
      <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
      <span className="w-12 shrink-0 text-sm font-semibold tabular-nums" aria-live="off">
        {formatDuration(elapsedMs)}
      </span>
      <div className="flex h-8 min-w-0 flex-1 items-center gap-[3px]" aria-hidden>
        {recent.map((level, i) => (
          <span
            key={i}
            className="w-[3px] flex-1 rounded-full bg-coral/80 transition-[height] duration-75"
            style={{ height: `${meterHeight(level)}%` }}
          />
        ))}
      </div>
      <span className="hidden text-xs text-faint sm:inline">max {formatDuration(MAX_VOICE_MS)}</span>
      <button
        type="button"
        onClick={onSend}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-ink shadow-glow transition hover:brightness-110"
        aria-label="Send voice note"
      >
        <SendHorizontal className="size-5" />
      </button>
    </motion.div>
  )
}
