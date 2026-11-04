import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AtSign, KeyRound, LogIn, LogOut, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { ago } from '@/lib/time'
import type { SecurityEvent, SecurityEventKind } from '@/lib/types'

const KINDS: Record<SecurityEventKind, { label: string; icon: ReactNode; warn?: boolean }> = {
  sign_in: { label: 'Signed in', icon: <LogIn className="size-4" /> },
  sign_in_failed: { label: 'Wrong password entered', icon: <ShieldAlert className="size-4" />, warn: true },
  password_changed: { label: 'Password changed', icon: <KeyRound className="size-4" /> },
  password_reset: { label: 'Password reset from an email link', icon: <KeyRound className="size-4" /> },
  email_change_requested: { label: 'Asked to change the email address', icon: <AtSign className="size-4" /> },
  email_changed: { label: 'Email address changed', icon: <AtSign className="size-4" /> },
  two_factor_on: { label: 'Two-factor sign-in turned on', icon: <ShieldCheck className="size-4" /> },
  two_factor_off: { label: 'Two-factor sign-in turned off', icon: <ShieldOff className="size-4" />, warn: true },
  signed_out_everywhere: { label: 'Signed out everywhere', icon: <LogOut className="size-4" /> },
}

export function describeEvent(event: SecurityEvent): string {
  return KINDS[event.kind]?.label ?? event.kind
}

/** The last few things that touched the account's security, newest first. */
export function SecurityLog() {
  const events = useQuery({ queryKey: keys.securityEvents, queryFn: api.securityEvents })
  if (events.isPending) return <Spinner className="text-coral" />
  if (events.isError)
    return <p className="text-sm text-danger">Couldn't load recent activity. {events.error.message}</p>
  if (events.data.length === 0) return <p className="text-sm text-muted">Nothing yet.</p>

  return (
    <ol className="divide-y divide-line" aria-label="Recent security activity">
      {events.data.map((event) => {
        const kind = KINDS[event.kind]
        return (
          <li key={event.id} className="flex items-start gap-3 py-3">
            <span
              className={clsx(
                'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
                kind?.warn ? 'bg-apricot/12 text-apricot' : 'bg-raised text-muted',
              )}
            >
              {kind?.icon ?? <ShieldCheck className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] text-cream">{describeEvent(event)}</p>
              <p className="mt-0.5 text-xs [overflow-wrap:anywhere] text-faint">
                {[event.device, event.ip_address, ago(event.created_at)].filter(Boolean).join(' · ')}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
