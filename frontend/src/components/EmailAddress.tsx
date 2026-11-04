import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MailCheck, MailQuestion, RotateCw, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { Me } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { useToasts } from '@/store/live'

/** A loose check, so an obvious typo is caught before the server is asked. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

export function useSaveMe() {
  const queryClient = useQueryClient()
  const setUser = useAuth((s) => s.setUser)
  return (me: Me) => {
    setUser(me)
    queryClient.setQueryData(keys.me, me)
  }
}

/** The address they sign in with, and a way to move to a new one that has to confirm first. */
export function EmailAddressForm({ user }: { user: Me }) {
  const [editing, setEditing] = useState(false)
  const pending = user.pending_email ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 font-semibold [overflow-wrap:anywhere] text-cream">{user.email}</span>
        {user.email_verified ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-mint">
            <MailCheck className="size-3.5" /> Confirmed
          </span>
        ) : (
          <span className="text-xs font-semibold text-apricot">Not confirmed yet</span>
        )}
      </div>
      {pending ? (
        <PendingChange pending={pending} />
      ) : editing ? (
        <ChangeForm current={user.email} onDone={() => setEditing(false)} />
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
          Change email
        </button>
      )}
    </div>
  )
}

function ChangeForm({ current, onDone }: { current: string; onDone: () => void }) {
  const saveMe = useSaveMe()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const same = email.trim().toLowerCase() === current.toLowerCase()
  const invalid = email.length > 0 && !looksLikeEmail(email)

  const ask = useMutation({
    mutationFn: () => api.changeEmail(email.trim(), password),
    onSuccess: (me) => {
      saveMe(me)
      onDone()
      useToasts.getState().push({ title: 'Check your new inbox', body: `We sent a link to ${me.pending_email}.` })
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!same && !invalid) ask.mutate()
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="label">New email</span>
        <input
          className="field"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={invalid || same}
          autoFocus
          required
        />
      </label>
      <label className="block">
        <span className="label">Your password</span>
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn-primary" disabled={ask.isPending || !email || !password || same || invalid}>
          {ask.isPending && <Spinner className="size-4" />} Send confirmation link
        </button>
        <button type="button" className="btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <p role="status" className="text-sm text-danger">
          {same
            ? "That's the address you already use."
            : invalid
              ? "That doesn't look like an email address."
              : ask.isError
                ? ask.error.message
                : ''}
        </p>
      </div>
    </form>
  )
}

function PendingChange({ pending }: { pending: string }) {
  const saveMe = useSaveMe()
  const resend = useMutation({
    mutationFn: api.resendEmailChange,
    onSuccess: () => useToasts.getState().push({ title: 'Sent again', body: `Look for it at ${pending}.` }),
  })
  const cancel = useMutation({ mutationFn: api.cancelEmailChange, onSuccess: saveMe })

  return (
    <div className="rounded-2xl border border-line bg-raised/60 p-4">
      <p className="flex items-start gap-2 text-sm [overflow-wrap:anywhere]">
        <MailQuestion className="mt-0.5 size-4 shrink-0 text-apricot" />
        <span className="min-w-0">
          Waiting for you to confirm <strong className="text-cream">{pending}</strong>. Until you follow the link we
          sent there, you keep signing in with your current address.
        </span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-ghost text-sm" disabled={resend.isPending} onClick={() => resend.mutate()}>
          {resend.isPending ? <Spinner className="size-4" /> : <RotateCw className="size-4" />} Send the link again
        </button>
        <button type="button" className="btn-ghost text-sm" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
          {cancel.isPending ? <Spinner className="size-4" /> : <X className="size-4" />} Keep my current email
        </button>
      </div>
      {(resend.isError || cancel.isError) && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {(resend.error ?? cancel.error)?.message}
        </p>
      )}
    </div>
  )
}
