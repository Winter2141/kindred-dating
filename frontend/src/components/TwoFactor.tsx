import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Download, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { TwoFactorSetup } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { useToasts } from '@/store/live'
import { Dialog, Spinner } from './ui'

/** "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP", easier to type into an app. */
export function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret
}

/** A one-time code box: digits for the app, or letters too when typing a recovery code. */
export function CodeInput({
  value,
  onChange,
  recovery = false,
  label = 'Code from your authenticator app',
}: {
  value: string
  onChange: (value: string) => void
  recovery?: boolean
  label?: string
}) {
  return (
    <label className="block">
      <span className="label">{recovery ? 'Recovery code' : label}</span>
      <input
        className="field text-center font-mono text-2xl tracking-[0.4em]"
        inputMode={recovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        placeholder={recovery ? 'xxxx-xxxx' : '000000'}
        maxLength={recovery ? 9 : 6}
        value={value}
        onChange={(e) => onChange(recovery ? e.target.value.toLowerCase() : e.target.value.replace(/\D/g, ''))}
        required
      />
    </label>
  )
}

/** Shown once after turning it on (or making new codes): copy or download them. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = `Kindred recovery codes. Each works once.\n\n${codes.join('\n')}\n`
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-muted">
        If you lose your phone, each of these codes gets you in once. Keep them somewhere safe: this is the only time
        we'll show them.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-3xl border border-line bg-raised/60 p-4 font-mono text-[15px]">
        {codes.map((code) => (
          <li key={code} className="text-center">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            await navigator.clipboard?.writeText(text)
            setCopied(true)
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          className="btn-secondary"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download="kindred-recovery-codes.txt"
        >
          <Download className="size-4" /> Download
        </a>
        <button type="button" className="btn-primary ml-auto" onClick={onDone}>
          I've saved them
        </button>
      </div>
    </div>
  )
}

/** In Settings: turn two-factor sign-in on or off, and make new recovery codes. */
export function TwoFactorSettings() {
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: keys.twoFactor, queryFn: api.twoFactorStatus })
  const [dialog, setDialog] = useState<'setup' | 'disable' | 'codes' | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.twoFactor })
    void queryClient.invalidateQueries({ queryKey: keys.me })
  }

  if (!status.data) return <Spinner className="text-coral" />
  const { enabled, recovery_codes_left: left } = status.data
  return (
    <div className="space-y-4">
      {enabled ? (
        <>
          <p className="flex items-center gap-2 font-semibold text-mint">
            <ShieldCheck className="size-5" /> On. You'll need a code from your app to sign in.
          </p>
          <p className="text-sm text-muted">
            {left} recovery code{left === 1 ? '' : 's'} left.
            {left <= 3 && ' Make new ones before you run out.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => setDialog('codes')}>
              <KeyRound className="size-4" /> New recovery codes
            </button>
            <button type="button" className="btn-ghost text-danger" onClick={() => setDialog('disable')}>
              <ShieldOff className="size-4" /> Turn off
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn-primary" onClick={() => setDialog('setup')}>
          <ShieldCheck className="size-4" /> Turn on two-factor sign-in
        </button>
      )}

      <SetupDialog open={dialog === 'setup'} onClose={() => setDialog(null)} onEnabled={refresh} />
      <DisableDialog
        open={dialog === 'disable'}
        onClose={() => setDialog(null)}
        onDisabled={() => {
          refresh()
          setDialog(null)
          useToasts.getState().push({ title: 'Two-factor sign-in is off' })
        }}
      />
      <NewCodesDialog open={dialog === 'codes'} onClose={() => setDialog(null)} onMade={refresh} />
    </div>
  )
}

function SetupDialog({ open, onClose, onEnabled }: { open: boolean; onClose: () => void; onEnabled: () => void }) {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const start = useMutation({ mutationFn: api.startTwoFactor, onSuccess: setSetup })
  const enable = useMutation({
    mutationFn: () => api.enableTwoFactor(code),
    onSuccess: (result) => {
      setCodes(result.recovery_codes)
      onEnabled()
    },
  })
  const close = () => {
    setSetup(null)
    setCode('')
    setCodes(null)
    start.reset()
    enable.reset()
    onClose()
  }
  // Ask for a secret as the dialog opens, once per opening.
  const requested = useRef(false)
  const { mutate: begin } = start
  useEffect(() => {
    if (!open) {
      requested.current = false
      return
    }
    if (requested.current) return
    requested.current = true
    begin()
  }, [open, begin])

  return (
    <Dialog open={open} onClose={close} title={codes ? 'Save your recovery codes' : 'Set up your authenticator'}>
      {codes ? (
        <RecoveryCodes codes={codes} onDone={close} />
      ) : !setup ? (
        <div className="grid place-items-center py-10">
          {start.isError ? <p className="text-danger">{start.error.message}</p> : <Spinner className="text-coral" />}
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (code.length === 6) enable.mutate()
          }}
        >
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Open an authenticator app (Google Authenticator, 1Password, Authy…).</li>
            <li>Scan the code, or type the key under it.</li>
            <li>Enter the six digits it shows.</li>
          </ol>
          <div className="flex flex-col items-center gap-3">
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qr_svg)}`}
              alt="QR code to scan with your authenticator app"
              className="size-48 rounded-2xl bg-white p-2"
            />
            <code className="rounded-xl bg-raised px-3 py-1.5 text-sm tracking-wider text-apricot select-all">
              {groupSecret(setup.secret)}
            </code>
          </div>
          <CodeInput value={code} onChange={setCode} />
          {enable.isError && <p className="text-sm text-danger">{enable.error.message}</p>}
          <button type="submit" className="btn-primary w-full" disabled={code.length !== 6 || enable.isPending}>
            {enable.isPending ? <Spinner className="size-4" /> : 'Turn it on'}
          </button>
        </form>
      )}
    </Dialog>
  )
}

function DisableDialog({ open, onClose, onDisabled }: { open: boolean; onClose: () => void; onDisabled: () => void }) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const disable = useMutation({ mutationFn: () => api.disableTwoFactor(password, code), onSuccess: onDisabled })
  return (
    <Dialog open={open} onClose={onClose} title="Turn off two-factor sign-in">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          disable.mutate()
        }}
      >
        <label className="block">
          <span className="label">Password</span>
          <input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <CodeInput value={code} onChange={setCode} recovery={recovery} />
        <button type="button" className="text-sm font-semibold text-apricot hover:underline" onClick={() => setRecovery((r) => !r)}>
          {recovery ? 'Use a code from the app' : 'Use a recovery code instead'}
        </button>
        {disable.isError && <p className="text-sm text-danger">{disable.error.message}</p>}
        <button type="submit" className="btn w-full bg-danger font-bold text-ink" disabled={disable.isPending}>
          {disable.isPending ? <Spinner className="size-4" /> : 'Turn off'}
        </button>
      </form>
    </Dialog>
  )
}

function NewCodesDialog({ open, onClose, onMade }: { open: boolean; onClose: () => void; onMade: () => void }) {
  const [password, setPassword] = useState('')
  const make = useMutation({ mutationFn: () => api.regenerateRecoveryCodes(password), onSuccess: onMade })
  const close = () => {
    setPassword('')
    make.reset()
    onClose()
  }
  return (
    <Dialog open={open} onClose={close} title="New recovery codes">
      {make.data ? (
        <RecoveryCodes codes={make.data.recovery_codes} onDone={close} />
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            make.mutate()
          }}
        >
          <p className="text-sm text-muted">Your old codes will stop working.</p>
          <label className="block">
            <span className="label">Password</span>
            <input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {make.isError && <p className="text-sm text-danger">{make.error.message}</p>}
          <button type="submit" className="btn-primary w-full" disabled={make.isPending}>
            {make.isPending ? <Spinner className="size-4" /> : 'Make new codes'}
          </button>
        </form>
      )}
    </Dialog>
  )
}

/** The second step of signing in, after the password. */
export function TwoFactorStep({ mfaToken, onBack }: { mfaToken: string; onBack: () => void }) {
  const signIn = useAuth((s) => s.signIn)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const verify = useMutation({ mutationFn: () => api.loginWithCode(mfaToken, code), onSuccess: signIn })
  return (
    <form
      className="mt-10 space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        verify.mutate()
      }}
    >
      <CodeInput value={code} onChange={setCode} recovery={recovery} />
      {verify.isError && (
        <p className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          {verify.error.message}
        </p>
      )}
      <button type="submit" className="btn-primary w-full py-4 text-base" disabled={verify.isPending}>
        {verify.isPending ? <Spinner className="size-5" /> : 'Sign in'}
      </button>
      <div className="flex justify-between text-sm">
        <button type="button" className="font-semibold text-apricot hover:underline" onClick={() => setRecovery((r) => !r)}>
          {recovery ? 'Use a code from the app' : 'Lost your phone? Use a recovery code'}
        </button>
        <button type="button" className="text-muted hover:text-cream" onClick={onBack}>
          Start over
        </button>
      </div>
    </form>
  )
}
