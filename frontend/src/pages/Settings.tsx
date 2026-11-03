import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, EyeOff, KeyRound, LogOut, MonitorSmartphone, Trash2 } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { BlockedList } from '@/components/Safety'
import { Spinner, Switch } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { Me } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { useToasts } from '@/store/live'

export function SettingsPage() {
  const user = useAuth((s) => s.user)
  if (!user) return null
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-5 pb-28 sm:px-8 lg:pt-10">
      <header className="mb-8">
        <h1 className="font-display text-5xl leading-none">Settings</h1>
        <p className="mt-2 text-sm text-muted">Signed in as {user.email}</p>
      </header>
      <div className="space-y-6">
        <VisibilitySection user={user} />
        <PasswordSection />
        <SessionsSection />
        <Section
          icon={<Ban className="size-5" />}
          title="Blocked people"
          description="They can't see you and you can't see them. Unblocking puts them back in Discover."
        >
          <BlockedList />
        </Section>
        <DeleteSection />
      </div>
    </div>
  )
}

function Section({
  icon,
  title,
  description,
  children,
  danger,
}: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
  danger?: boolean
}) {
  return (
    <section className={danger ? 'card border-danger/30 p-6 sm:p-8' : 'card p-6 sm:p-8'}>
      <div className="flex gap-4">
        <span
          className={
            danger
              ? 'grid size-11 shrink-0 place-items-center rounded-2xl bg-danger/12 text-danger'
              : 'grid size-11 shrink-0 place-items-center rounded-2xl bg-raised text-coral'
          }
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-3xl leading-tight">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </section>
  )
}

function useSaveMe() {
  const queryClient = useQueryClient()
  const setUser = useAuth((s) => s.setUser)
  return (me: Me) => {
    setUser(me)
    queryClient.setQueryData(keys.me, me)
  }
}

function VisibilitySection({ user }: { user: Me }) {
  const saveMe = useSaveMe()
  const pause = useMutation({
    mutationFn: (paused: boolean) => api.updateMe({ is_paused: paused }),
    onSuccess: (me) => {
      saveMe(me)
      useToasts.getState().push({
        title: me.is_paused ? 'Profile paused' : 'Welcome back',
        body: me.is_paused ? "You won't appear in anyone's deck." : 'People can find you again.',
      })
    },
  })
  return (
    <Section
      icon={<EyeOff className="size-5" />}
      title="Take a break"
      description="Pausing hides you from Discover. Your matches and conversations stay exactly as they are."
    >
      <Switch
        checked={user.is_paused}
        disabled={pause.isPending}
        onChange={(paused) => pause.mutate(paused)}
        label="Pause my profile"
      />
    </Section>
  )
}

export function PasswordSection() {
  const signIn = useAuth((s) => s.signIn)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const mismatch = confirm.length > 0 && next !== confirm
  const tooShort = next.length > 0 && next.length < 8

  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: (session) => {
      signIn(session)
      setCurrent('')
      setNext('')
      setConfirm('')
      useToasts.getState().push({
        title: 'Password changed',
        body: 'Your other devices have been signed out.',
      })
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!mismatch && !tooShort) change.mutate()
  }

  return (
    <Section
      icon={<KeyRound className="size-5" />}
      title="Password"
      description="Changing it signs you out on every other device."
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Current password</span>
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="label">New password</span>
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-invalid={tooShort}
            required
          />
        </label>
        <label className="block">
          <span className="label">Repeat new password</span>
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch}
            required
          />
        </label>
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
          <button
            type="submit"
            className="btn-primary"
            disabled={change.isPending || mismatch || tooShort || !current || !next}
          >
            {change.isPending && <Spinner className="size-4" />} Update password
          </button>
          <p role="status" className="text-sm text-danger">
            {tooShort
              ? 'Use at least 8 characters.'
              : mismatch
                ? "The new passwords don't match."
                : change.isError
                  ? change.error.message
                  : ''}
          </p>
        </div>
      </form>
    </Section>
  )
}

function SessionsSection() {
  const signOut = useAuth((s) => s.signOut)
  const everywhere = useMutation({ mutationFn: api.signOutEverywhere, onSuccess: signOut })
  return (
    <Section
      icon={<MonitorSmartphone className="size-5" />}
      title="Sessions"
      description="Lost a phone or used a shared computer? Sign out of Kindred everywhere, including here."
    >
      <button
        type="button"
        className="btn-secondary"
        disabled={everywhere.isPending}
        onClick={() => everywhere.mutate()}
      >
        {everywhere.isPending ? <Spinner className="size-4" /> : <LogOut className="size-4" />}
        Sign out everywhere
      </button>
    </Section>
  )
}

function DeleteSection() {
  const signOut = useAuth((s) => s.signOut)
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const remove = useMutation({
    mutationFn: () => api.deleteAccount(password),
    onSuccess: () => {
      queryClient.clear()
      signOut()
    },
  })
  return (
    <Section
      danger
      icon={<Trash2 className="size-5" />}
      title="Delete account"
      description="This permanently removes your profile, photos, matches and messages. It can't be undone."
    >
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            remove.mutate()
          }}
          className="space-y-4"
        >
          <label className="block max-w-sm">
            <span className="label">Enter your password to confirm</span>
            <input
              className="field"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          </label>
          {remove.isError && <p className="text-sm text-danger">{remove.error.message}</p>}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="btn bg-danger font-bold text-ink hover:brightness-110"
              disabled={!password || remove.isPending}
            >
              {remove.isPending && <Spinner className="size-4" />} Delete forever
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Keep my account
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-secondary text-danger" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" /> Delete my account
        </button>
      )}
    </Section>
  )
}
