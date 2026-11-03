import clsx from 'clsx'
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { acceptCall, hangUp, toggleCamera, toggleMic, useCall } from '@/lib/calls'
import { formatDuration } from '@/lib/voice'
import { Avatar } from './ui'

function StreamVideo({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (video.current) video.current.srcObject = stream
  }, [stream])
  return <video ref={video} autoPlay playsInline muted={muted} className={className} />
}

function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return startedAt ? Math.max(0, now - startedAt) : 0
}

function RoundButton({
  label,
  onClick,
  tone = 'plain',
  children,
}: {
  label: string
  onClick: () => void
  tone?: 'plain' | 'danger' | 'accept' | 'off'
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx(
        'grid size-14 place-items-center rounded-full transition hover:brightness-110 active:scale-95',
        tone === 'danger' && 'bg-danger text-ink',
        tone === 'accept' && 'bg-mint text-ink',
        tone === 'plain' && 'glass border border-line-strong text-cream',
        tone === 'off' && 'bg-cream text-ink',
      )}
    >
      {children}
    </button>
  )
}

/** The whole-screen call UI: ringing in or out, connecting, and the call itself. */
export function CallScreen() {
  const call = useCall()
  const elapsed = useElapsed(call.startedAt)
  const open = call.phase !== 'idle'
  const video = call.kind === 'video'
  const peerName = call.peer?.name ?? 'Your match'

  // Ring for an incoming call with a soft repeating tone (where autoplay allows it).
  useEffect(() => {
    if (call.phase !== 'incoming') return
    if (typeof AudioContext === 'undefined') return
    const context = new AudioContext()
    const ring = () => {
      const tone = context.createOscillator()
      const gain = context.createGain()
      tone.frequency.value = 660
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.9)
      tone.connect(gain).connect(context.destination)
      tone.start()
      tone.stop(context.currentTime + 1)
    }
    ring()
    const timer = setInterval(ring, 2200)
    return () => {
      clearInterval(timer)
      void context.close().catch(() => {})
    }
  }, [call.phase])

  const status =
    call.phase === 'starting'
      ? 'Getting your camera ready…'
      : call.phase === 'outgoing'
        ? 'Ringing…'
        : call.phase === 'incoming'
          ? `Incoming ${call.kind} call`
          : call.phase === 'connecting'
            ? 'Connecting…'
            : formatDuration(elapsed)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Call with ${peerName}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex flex-col bg-ink"
        >
          {video && call.remoteStream && call.phase === 'live' ? (
            <StreamVideo stream={call.remoteStream} className="absolute inset-0 size-full object-cover" />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-surface to-ink">
              <div className="flex flex-col items-center">
                <span className={clsx('rounded-full', call.phase !== 'live' && 'animate-pulse')}>
                  <Avatar src={call.peer?.photo ?? undefined} name={peerName} size={136} ring />
                </span>
                {!video && call.remoteStream && <StreamVideo stream={call.remoteStream} className="hidden" />}
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink/80 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-ink/90 to-transparent" />

          <header className="relative z-10 px-6 pt-[max(2rem,env(safe-area-inset-top))] text-center">
            <h2 className="font-display text-4xl">{peerName}</h2>
            <p className="mt-1 text-sm text-cream/80 tabular-nums" aria-live="polite">
              {status}
            </p>
          </header>

          {video && call.localStream && call.phase !== 'incoming' && (
            <div className="absolute right-4 bottom-36 z-10 aspect-[3/4] w-28 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-card sm:w-40">
              {call.cameraOn ? (
                <StreamVideo stream={call.localStream} muted className="size-full -scale-x-100 object-cover" />
              ) : (
                <div className="grid size-full place-items-center text-xs text-muted">Camera off</div>
              )}
            </div>
          )}

          <div className="relative z-10 mt-auto flex items-center justify-center gap-5 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
            {call.phase === 'incoming' ? (
              <>
                <RoundButton label="Decline" tone="danger" onClick={() => hangUp('declined')}>
                  <PhoneOff className="size-6" />
                </RoundButton>
                <RoundButton label="Answer" tone="accept" onClick={() => void acceptCall()}>
                  {video ? <Video className="size-6" /> : <Phone className="size-6" />}
                </RoundButton>
              </>
            ) : (
              <>
                <RoundButton label={call.micOn ? 'Mute' : 'Unmute'} tone={call.micOn ? 'plain' : 'off'} onClick={toggleMic}>
                  {call.micOn ? <Mic className="size-6" /> : <MicOff className="size-6" />}
                </RoundButton>
                {video && (
                  <RoundButton
                    label={call.cameraOn ? 'Turn camera off' : 'Turn camera on'}
                    tone={call.cameraOn ? 'plain' : 'off'}
                    onClick={toggleCamera}
                  >
                    {call.cameraOn ? <Video className="size-6" /> : <VideoOff className="size-6" />}
                  </RoundButton>
                )}
                <RoundButton
                  label={call.phase === 'live' || call.phase === 'connecting' ? 'Hang up' : 'Cancel call'}
                  tone="danger"
                  onClick={() => hangUp(call.phase === 'live' || call.phase === 'connecting' ? 'ended' : 'cancelled')}
                >
                  <PhoneOff className="size-6" />
                </RoundButton>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
