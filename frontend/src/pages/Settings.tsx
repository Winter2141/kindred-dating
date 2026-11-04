import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AtSign,
  Ban,
  BadgeCheck,
  BellRing,
  EyeOff,
  FileDown,
  Gavel,
  KeyRound,
  LogOut,
  Mail,
  MonitorSmartphone,
  Moon,
  Palette,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { DeviceList } from '@/components/Devices'
import { EmailAddressForm, useSaveMe } from '@/components/EmailAddress'
import { EmailPrefsForm } from '@/components/EmailPrefs'
import { QuietHoursForm } from '@/components/QuietHours'
import { SecurityLog } from '@/components/SecurityLog'
import { BlockedList } from '@/components/Safety'
import { Segmented } from '@/components/ProfileFields'
import { TwoFactorSettings } from '@/components/TwoFactor'
import type { ThemeChoice } from '@/lib/theme'
import { VerificationFlow } from '@/components/Verification'
import { Spinner, Switch } from '@/components/ui'
import { api } from '@/lib/api'
import { desktopPermission, requestDesktopPermission, type DesktopPermission } from '@/lib/desktop'
import type { Me } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { useToasts } from '@/store/live'
import { usePrefs } from '@/store/prefs'

export function SettingsPage() {
  const user = useAuth((s) => s.user)
  if (!user) return null
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-5 pb-28 sm:px-8 lg:pt-10">
      <header className="mb-8">
        <h1 className="font-display text-5xl leading-none">Settings</h1>
        <p className="mt-2 text-sm text-muted">Signed in as {user.email}</p>
        {user.is_admin && (
          <Link to="/app/moderation" className="btn-secondary mt-5">
            <Gavel className="size-4" /> Open the moderation queue
          </Link>
        )}
      </header>
      <div className="space-y-6">
        <VisibilitySection user={user} />
        <AppearanceSection />
        <Section
          icon={<BadgeCheck className="size-5" />}
          title="Verify your photos"
          description="Copy a pose in a quick selfie and a moderator checks it's really you. Verified profiles get a blue tick, and the selfie is deleted after review."
        >
          <VerificationFlow hasPhotos={user.photos.length > 0} />
        </Section>
        <DesktopSection />
        <Section
          icon={<Moon className="size-5" />}
          title="Quiet hours"
          description="Set a nightly window when Kindred stays quiet: no desktop alerts, and email digests wait until morning. Everything is still there when you look."
        >
          <QuietHoursForm user={user} />
        </Section>
        <Section
          icon={<AtSign className="size-5" />}
          title="Email address"
          description="Where we send sign-in links and digests, and what you sign in with. A new address has to confirm before it replaces this one."
        >
          <EmailAddressForm user={user} />
        </Section>
        <Section
          id="email"
          icon={<Mail className="size-5" />}
          title="Email"
          description="Missed something while you were away? We'll gather it into one email, so you hear about it without being flooded."
        >
          <EmailPrefsForm />
        </Section>
        <PasswordSection />
        <Section
          icon={<ShieldCheck className="size-5" />}
          title="Two-factor sign-in"
          description="Ask for a code from an authenticator app as well as your password, so a leaked password isn't enough."
        >
          <TwoFactorSettings />
        </Section>
        <SessionsSection />
        <Section
          icon={<Ban className="size-5" />}
          title="Blocked people"
          description="They can't see you and you can't see them. Unblocking puts them back in Discover."
        >
          <BlockedList />
        </Section>
        <Section
          icon={<FileDown className="size-5" />}
          title="Your data"
          description="Download everything Kindred holds about you: your profile, answers, swipes, conversations, dates and notifications, as one JSON file."
        >
          <ExportButton />
        </Section>
        <DeleteSection />
      </div>
    </div>
  )
}

function Section({
  id,
  icon,
  title,
  description,
  children,
  danger,
}: {
  id?: string
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
  danger?: boolean
}) {
  return (
    <section id={id} className={danger ? 'card scroll-mt-6 border-danger/30 p-6 sm:p-8' : 'card scroll-mt-6 p-6 sm:p-8'}>
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

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Match my device' },
]

export function AppearanceSection() {
  const theme = usePrefs((s) => s.theme)
  const setTheme = usePrefs((s) => s.setTheme)
  return (
    <Section icon={<Palette className="size-5" />} title="Appearance" description="Kindred looks its best in the dark, but it's your call. Saved on this device.">
      <Segmented label="Theme" value={[theme]} onChange={([value]) => setTheme(value)} options={THEMES} />
    </Section>
  )
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ExportButton() {
  const download = useMutation({
    mutationFn: api.exportData,
    onSuccess: (blob) => saveBlob(blob, `kindred-export-${new Date().toISOString().slice(0, 10)}.json`),
    onError: (error) => useToasts.getState().push({ title: "Couldn't export", body: error.message }),
  })
  return (
    <button type="button" className="btn-secondary" disabled={download.isPending} onClick={() => download.mutate()}>
      {download.isPending ? <Spinner className="size-4" /> : <FileDown className="size-4" />} Download my data
    </button>
  )
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
  const privately = useMutation({
    mutationFn: (on: boolean) => api.updateMe({ browse_privately: on }),
    onSuccess: saveMe,
    onError: (error) => useToasts.getState().push({ title: "Couldn't save that", body: error.message }),
  })
  return (
    <Section
      icon={<EyeOff className="size-5" />}
      title="Visibility"
      description="Pausing hides you from Discover; your matches and conversations stay exactly as they are. Browsing privately keeps your profile views to yourself."
    >
      <div className="flex flex-col gap-4">
        <Switch
          checked={user.is_paused}
          disabled={pause.isPending}
          onChange={(paused) => pause.mutate(paused)}
          label="Pause my profile"
        />
        <Switch
          checked={user.browse_privately ?? false}
          disabled={privately.isPending}
          onChange={(on) => privately.mutate(on)}
          label="Browse privately"
        />
        <p className="-mt-2 text-xs text-faint">
          People won't see that you looked at their profile. In return, you won't see who looked at yours.
        </p>
      </div>
    </Section>
  )
}

export function DesktopSection() {
  const enabled = usePrefs((s) => s.desktopNotifications)
  const setEnabled = usePrefs((s) => s.setDesktopNotifications)
  const [permission, setPermission] = useState<DesktopPermission>(desktopPermission)

  const toggle = async (on: boolean) => {
    if (!on) {
      setEnabled(false)
      return
    }
    const result = permission === 'granted' ? permission : await requestDesktopPermission()
    setPermission(result)
    setEnabled(result === 'granted')
  }

  return (
    <Section
      icon={<BellRing className="size-5" />}
      title="Desktop notifications"
      description="Get a system notification for new messages, likes and matches while Kindred is in another tab."
    >
      <Switch
        checked={enabled && permission === 'granted'}
        disabled={permission === 'unsupported' || permission === 'denied'}
        onChange={(on) => void toggle(on)}
        label="Notify me on this device"
      />
      {(permission === 'denied' || permission === 'unsupported') && (
        <p className="mt-3 text-sm text-apricot">
          {permission === 'denied'
            ? 'Notifications are blocked for this site. Allow them in your browser settings to turn this on.'
            : "This browser doesn't support notifications."}
        </p>
      )}
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
      title="Where you're signed in"
      description="Don't recognise one? Sign it out, then change your password. Lost a phone or used a shared computer? You can sign out everywhere at once, including here."
    >
      <DeviceList />
      <details className="group mt-4 rounded-2xl border border-line bg-raised/40 px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-muted group-open:text-cream hover:text-cream">
          Recent security activity
        </summary>
        <div className="mt-2">
          <SecurityLog />
        </div>
      </details>
      <button
        type="button"
        className="btn-ghost mt-3 text-sm text-danger"
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
