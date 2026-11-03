import { useMutation } from '@tanstack/react-query'
import { MailWarning, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/lib/api'
import { useAuth } from '@/store/auth'
import { useToasts } from '@/store/live'
import { Spinner } from './ui'

/** Asks people who haven't confirmed their email yet to do it, with a way to resend. */
export function EmailBanner() {
  const user = useAuth((s) => s.user)
  const [hidden, setHidden] = useState(false)
  const resend = useMutation({
    mutationFn: api.resendVerification,
    onSuccess: () => useToasts.getState().push({ title: 'Sent', body: `Check ${user?.email} for a fresh link.` }),
    onError: (error) => useToasts.getState().push({ title: "Couldn't send it", body: error.message }),
  })
  if (!user || user.email_verified !== false || hidden) return null

  return (
    <div className="flex items-center gap-3 border-b border-apricot/20 bg-apricot/10 px-4 py-2.5 text-sm sm:px-6" role="status">
      <MailWarning className="size-4 shrink-0 text-apricot" />
      <p className="min-w-0 flex-1 text-cream/90">
        Confirm your email so you can reset your password if you ever need to. We sent a link to{' '}
        <span className="font-semibold">{user.email}</span>.
      </p>
      <button
        type="button"
        className="shrink-0 font-semibold text-apricot hover:underline disabled:opacity-60"
        disabled={resend.isPending || resend.isSuccess}
        onClick={() => resend.mutate()}
      >
        {resend.isPending ? <Spinner className="size-3.5" /> : resend.isSuccess ? 'Sent' : 'Resend'}
      </button>
      <button
        type="button"
        onClick={() => setHidden(true)}
        className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-cream"
        aria-label="Hide for now"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
