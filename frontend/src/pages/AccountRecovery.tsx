import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Inbox, MailCheck, MailWarning, MailX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { ago } from '@/lib/time'
import { useAuth } from '@/store/auth'
import { AuthLayout, ErrorNote } from './Auth'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const ask = useMutation({ mutationFn: () => api.forgotPassword(email) })

  return (
    <AuthLayout>
      <Link to="/login" className="btn-ghost -ml-4 mb-6 self-start">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
      {ask.isSuccess ? (
        <div>
          <MailCheck className="size-10 text-mint" />
          <h1 className="mt-5 font-display text-5xl leading-none">Check your inbox</h1>
          <p className="mt-4 leading-relaxed text-muted">
            If there's a Kindred account for <span className="font-semibold text-cream">{email}</span>, we've sent it a
            link to choose a new password. It works once, for an hour.
          </p>
          {import.meta.env.DEV && (
            <Link to="/dev/outbox" className="btn-secondary mt-8">
              <Inbox className="size-4" /> Open the dev outbox
            </Link>
          )}
        </div>
      ) : (
        <>
          <h1 className="font-display text-6xl leading-none">Forgot your password?</h1>
          <p className="mt-3 text-muted">Tell us your email and we'll send you a link to reset it.</p>
          <form
            className="mt-10 space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              ask.mutate()
            }}
          >
            <label className="block">
              <span className="label">Email</span>
              <input
                className="field"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <ErrorNote message={ask.error?.message ?? null} />
            <button type="submit" className="btn-primary w-full py-4 text-base" disabled={ask.isPending}>
              {ask.isPending ? <Spinner className="size-5" /> : 'Send reset link'}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get('token') ?? ''
  const signIn = useAuth((s) => s.signIn)
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const mismatch = confirm.length > 0 && confirm !== password
  const reset = useMutation({
    mutationFn: () => api.resetPassword(token, password),
    onSuccess: (session) => {
      signIn(session)
      navigate('/app/discover', { replace: true })
    },
  })

  return (
    <AuthLayout>
      <h1 className="font-display text-6xl leading-none">Choose a new password</h1>
      <p className="mt-3 text-muted">You'll be signed out everywhere else and signed in here.</p>
      {!token ? (
        <div className="mt-8">
          <ErrorNote message="This page needs the link from your email." />
          <Link to="/forgot-password" className="btn-secondary mt-6">
            Send a new link
          </Link>
        </div>
      ) : (
        <form
          className="mt-10 space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!mismatch) reset.mutate()
          }}
        >
          <label className="block">
            <span className="label">New password</span>
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">Type it again</span>
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={mismatch}
            />
          </label>
          <ErrorNote message={mismatch ? "Those don't match yet." : (reset.error?.message ?? null)} />
          {reset.isError && (
            <Link to="/forgot-password" className="text-sm font-semibold text-apricot hover:underline">
              Send a new link
            </Link>
          )}
          <button type="submit" className="btn-primary w-full py-4 text-base" disabled={reset.isPending || mismatch}>
            {reset.isPending ? <Spinner className="size-5" /> : 'Save and sign in'}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}

export function VerifyEmailPage() {
  const token = useSearchParams()[0].get('token') ?? ''
  const signedIn = Boolean(useAuth((s) => s.token))
  const queryClient = useQueryClient()
  const verify = useMutation({
    mutationFn: () => api.verifyEmail(token),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.me }),
  })
  // Confirm once on arrival; StrictMode mounts effects twice in development.
  const sent = useRef(false)
  const { mutate } = verify
  useEffect(() => {
    if (!token || sent.current) return
    sent.current = true
    mutate()
  }, [token, mutate])

  return (
    <AuthLayout>
      {verify.isSuccess ? (
        <div>
          <MailCheck className="size-10 text-mint" />
          <h1 className="mt-5 font-display text-5xl leading-none">Email confirmed</h1>
          <p className="mt-4 text-muted">Thanks! {verify.data.email} is all set.</p>
          <Link to={signedIn ? '/app/discover' : '/login'} className="btn-primary mt-8">
            {signedIn ? 'Back to Kindred' : 'Sign in'}
          </Link>
        </div>
      ) : verify.isError || !token ? (
        <div>
          <MailWarning className="size-10 text-danger" />
          <h1 className="mt-5 font-display text-5xl leading-none">That link didn't work</h1>
          <p className="mt-4 text-muted">
            It may have expired. {signedIn ? 'You can send a fresh one from the banner in the app.' : 'Sign in to send a fresh one.'}
          </p>
          <Link to={signedIn ? '/app/discover' : '/login'} className="btn-secondary mt-8">
            {signedIn ? 'Back to Kindred' : 'Sign in'}
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-muted">
          <Spinner className="text-coral" /> Confirming your email…
        </div>
      )}
    </AuthLayout>
  )
}

/**
 * The link at the bottom of every digest. It waits for a click instead of acting on arrival,
 * because mail scanners open links in emails and would unsubscribe people by accident.
 */
export function ConfirmEmailChangePage() {
  const token = useSearchParams()[0].get('token') ?? ''
  const signedIn = Boolean(useAuth((s) => s.token))
  const queryClient = useQueryClient()
  const confirm = useMutation({
    mutationFn: () => api.confirmEmailChange(token),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.me }),
  })
  // Confirm once on arrival; StrictMode mounts effects twice in development.
  const sent = useRef(false)
  const { mutate } = confirm
  useEffect(() => {
    if (!token || sent.current) return
    sent.current = true
    mutate()
  }, [token, mutate])

  const home = signedIn ? '/app/settings' : '/login'
  return (
    <AuthLayout>
      {confirm.isSuccess ? (
        <div>
          <MailCheck className="size-10 text-mint" />
          <h1 className="mt-5 font-display text-5xl leading-none">New email confirmed</h1>
          <p className="mt-4 text-muted">From now on, sign in with {confirm.data.email}.</p>
          <Link to={home} className="btn-primary mt-8">
            {signedIn ? 'Back to Settings' : 'Sign in'}
          </Link>
        </div>
      ) : confirm.isError || !token ? (
        <div>
          <MailWarning className="size-10 text-danger" />
          <h1 className="mt-5 font-display text-5xl leading-none">That link didn't work</h1>
          <p className="mt-4 text-muted">
            {confirm.error?.message ?? 'The link is missing its code'}. Your email hasn't changed; you can ask for a
            new link in Settings.
          </p>
          <Link to={home} className="btn-secondary mt-8">
            {signedIn ? 'Open Settings' : 'Sign in'}
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-muted">
          <Spinner className="text-coral" /> Confirming your new email…
        </div>
      )}
    </AuthLayout>
  )
}

export function UnsubscribePage() {
  const token = useSearchParams()[0].get('token') ?? ''
  const signedIn = Boolean(useAuth((s) => s.token))
  const queryClient = useQueryClient()
  const stop = useMutation({
    mutationFn: () => api.unsubscribe(token),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.emailPrefs }),
  })
  const back = signedIn ? '/app/settings#email' : '/login'

  return (
    <AuthLayout>
      {stop.isSuccess ? (
        <div>
          <MailX className="size-10 text-mint" />
          <h1 className="mt-5 font-display text-5xl leading-none">You're unsubscribed</h1>
          <p className="mt-4 leading-relaxed text-muted">
            We won't email you about matches, messages, likes or dates. You'll still get sign-in and password
            links when you ask for them. Changed your mind? Pick what you'd like in Settings.
          </p>
          <Link to={back} className="btn-secondary mt-8">
            {signedIn ? 'Open email settings' : 'Sign in'}
          </Link>
        </div>
      ) : stop.isError || !token ? (
        <div>
          <MailWarning className="size-10 text-danger" />
          <h1 className="mt-5 font-display text-5xl leading-none">That link didn't work</h1>
          <p className="mt-4 text-muted">
            It may be too old. You can turn emails off any time in Settings, under Email.
          </p>
          <Link to={back} className="btn-secondary mt-8">
            {signedIn ? 'Open email settings' : 'Sign in'}
          </Link>
        </div>
      ) : (
        <div>
          <h1 className="font-display text-6xl leading-none">Stop Kindred emails?</h1>
          <p className="mt-4 leading-relaxed text-muted">
            This turns off every digest: new matches, unread messages, likes and date reminders.
          </p>
          <button
            type="button"
            className="btn-primary mt-8 w-full py-4 text-base"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            {stop.isPending ? <Spinner className="size-5" /> : 'Unsubscribe'}
          </button>
          <Link to={back} className="btn-ghost mt-3 w-full">
            Keep them coming
          </Link>
        </div>
      )}
    </AuthLayout>
  )
}

/** Shows what the outbox mail backend "sent", so the flows above work without a mail server. */
export function DevOutboxPage() {
  const outbox = useQuery({ queryKey: ['outbox'], queryFn: () => api.outbox(), retry: false, refetchInterval: 5000 })
  return (
    <div className="ambient mx-auto min-h-dvh w-full max-w-3xl px-5 py-10">
      <p className="label">Development</p>
      <h1 className="font-display text-5xl leading-none">Outbox</h1>
      <p className="mt-3 text-sm text-muted">
        Emails the API would have sent. Turn this off in production: it shows password reset links.
      </p>
      {outbox.isPending ? (
        <Spinner className="mt-10 text-coral" />
      ) : outbox.isError ? (
        <p className="mt-10 rounded-2xl border border-line bg-raised p-5 text-sm text-muted">
          The outbox is switched off. Start the API with <code className="text-apricot">KINDRED_EXPOSE_OUTBOX=true</code> to
          read it here.
        </p>
      ) : outbox.data.length === 0 ? (
        <p className="mt-10 text-muted">Nothing sent yet.</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {outbox.data.map((email) => (
            <li key={email.id} className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">{email.subject}</p>
                <span className="text-xs text-faint">{ago(email.created_at)}</span>
              </div>
              <p className="text-sm text-muted">To {email.to}</p>
              <pre className="mt-3 font-sans text-sm leading-relaxed whitespace-pre-wrap text-cream/90">
                {linkify(email.body)}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Turn links to this app into in-app links, so following them keeps the dev session. */
function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) => {
    if (!/^https?:\/\//.test(part)) return part
    const url = new URL(part)
    return (
      <Link key={i} to={`${url.pathname}${url.search}`} className="break-all text-apricot underline">
        {part}
      </Link>
    )
  })
}
