import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MailWarning } from 'lucide-react'
import { Spinner, Switch } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { EmailCategory, EmailPrefs } from '@/lib/types'

export const EMAIL_CATEGORIES: { key: EmailCategory; label: string; hint: string }[] = [
  { key: 'matches', label: 'New matches', hint: 'When someone you liked likes you back' },
  { key: 'messages', label: 'Unread messages', hint: 'Chats waiting for your reply' },
  { key: 'dates', label: 'Date reminders', hint: 'A couple of hours before a date you agreed to' },
  { key: 'likes', label: 'Likes', hint: 'People who liked your profile' },
]

/** Everything's off: the copy changes so it doesn't read like a broken form. */
export function allOff(prefs: EmailPrefs): boolean {
  return EMAIL_CATEGORIES.every(({ key }) => !prefs[key])
}

export function EmailPrefsForm() {
  const queryClient = useQueryClient()
  const prefs = useQuery({ queryKey: keys.emailPrefs, queryFn: api.emailPrefs })
  const save = useMutation({
    mutationFn: api.setEmailPrefs,
    // Flip the switch straight away; put it back if saving fails.
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: keys.emailPrefs })
      const before = queryClient.getQueryData<EmailPrefs>(keys.emailPrefs)
      if (before) queryClient.setQueryData<EmailPrefs>(keys.emailPrefs, { ...before, ...next })
      return { before }
    },
    onError: (_error, _next, context) => {
      if (context?.before) queryClient.setQueryData(keys.emailPrefs, context.before)
    },
    onSuccess: (saved) => queryClient.setQueryData(keys.emailPrefs, saved),
  })

  if (prefs.isPending) return <Spinner className="size-5 text-muted" />
  if (prefs.isError) return <p className="text-sm text-danger">Couldn't load your email settings.</p>

  const current = prefs.data
  return (
    <div>
      {!current.email_verified && (
        <p className="mb-4 flex items-start gap-2 rounded-2xl bg-apricot/10 px-4 py-3 text-sm text-apricot">
          <MailWarning className="mt-0.5 size-4 shrink-0" />
          Confirm your email address first: we only write to addresses we know are yours.
        </p>
      )}
      <ul className="space-y-4">
        {EMAIL_CATEGORIES.map(({ key, label, hint }) => (
          <li key={key} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold">{label}</p>
              <p className="text-xs text-muted">{hint}</p>
            </div>
            <Switch
              checked={current[key]}
              onChange={(on) => {
                const { email_verified: _verified, ...choices } = current
                save.mutate({ ...choices, [key]: on })
              }}
              label=""
              ariaLabel={label}
            />
          </li>
        ))}
      </ul>
      <p className="mt-5 text-xs text-muted" role="status">
        {save.isError
          ? `Couldn't save that: ${save.error.message}`
          : allOff(current)
            ? "You won't get any emails from us, apart from sign-in and password links."
            : "At most one email every six hours, and only when you haven't seen it in the app."}
      </p>
    </div>
  )
}
