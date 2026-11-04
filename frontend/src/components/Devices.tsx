import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Laptop, LogOut, Smartphone } from 'lucide-react'
import { Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { ago } from '@/lib/time'
import type { DeviceSession } from '@/lib/types'
import { useAuth } from '@/store/auth'

/** "Active now" for anything inside the server's five-minute touch window. */
export function deviceActivity(device: DeviceSession, now: Date = new Date()): string {
  if (device.current) return 'This device'
  const minutes = (now.getTime() - new Date(device.last_seen_at).getTime()) / 60_000
  if (minutes < 5) return 'Active now'
  return `Active ${ago(device.last_seen_at, now)}`
}

function signedInOn(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function DeviceRow({ device }: { device: DeviceSession }) {
  const queryClient = useQueryClient()
  const signOut = useAuth((s) => s.signOut)
  const end = useMutation({
    mutationFn: () => api.endSession(device.id),
    onSuccess: () => {
      if (device.current) signOut()
      else void queryClient.invalidateQueries({ queryKey: keys.deviceSessions })
    },
  })
  const Icon = device.mobile ? Smartphone : Laptop
  return (
    <li className="flex items-center gap-3 py-3">
      {/* On a phone the section is narrow enough already; the label says what it is. */}
      <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-raised text-muted sm:grid">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{device.label}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
          <span className={device.current ? 'font-medium text-coral' : undefined}>{deviceActivity(device)}</span>
          {device.ip_address && <span>{device.ip_address}</span>}
          <span>Signed in {signedInOn(device.created_at)}</span>
        </p>
      </div>
      <button
        type="button"
        className="btn-ghost shrink-0 text-sm"
        disabled={end.isPending}
        onClick={() => end.mutate()}
        aria-label={device.current ? 'Sign out of this device' : `Sign out ${device.label}`}
      >
        {end.isPending ? <Spinner className="size-4" /> : <LogOut className="size-4" />}
        <span className="hidden sm:inline">Sign out</span>
      </button>
    </li>
  )
}

export function DeviceList() {
  const queryClient = useQueryClient()
  const sessions = useQuery({ queryKey: keys.deviceSessions, queryFn: api.deviceSessions })
  const others = useMutation({
    mutationFn: api.signOutOtherSessions,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.deviceSessions }),
  })

  if (sessions.isPending) return <Spinner className="size-5 text-muted" />
  if (sessions.isError) return <p className="text-sm text-danger">Couldn't load your devices. {sessions.error.message}</p>

  const list = sessions.data
  const hasOthers = list.some((device) => !device.current)
  return (
    <div>
      <ul className="divide-y divide-line" aria-label="Signed-in devices">
        {list.map((device) => (
          <DeviceRow key={device.id} device={device} />
        ))}
      </ul>
      {hasOthers && (
        <button
          type="button"
          className="btn-secondary mt-4"
          disabled={others.isPending}
          onClick={() => others.mutate()}
        >
          {others.isPending ? <Spinner className="size-4" /> : <LogOut className="size-4" />}
          Sign out of all other devices
        </button>
      )}
    </div>
  )
}
