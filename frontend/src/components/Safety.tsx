import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Ban, Flag, HeartCrack, MoreHorizontal, ShieldCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { Match, PublicProfile, ReportReason } from '@/lib/types'
import { useToasts } from '@/store/live'
import { Avatar, Dialog, Spinner } from './ui'

export const REPORT_REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: 'fake_profile', label: 'Fake profile', hint: 'Photos or details that aren’t theirs' },
  { value: 'inappropriate', label: 'Inappropriate content', hint: 'Nudity, hate or violence' },
  { value: 'harassment', label: 'Harassment', hint: 'Threats, insults or unwanted advances' },
  { value: 'spam', label: 'Spam or scam', hint: 'Selling something or asking for money' },
  { value: 'underage', label: 'Might be under 18', hint: 'Kindred is for adults only' },
  { value: 'other', label: 'Something else', hint: 'Tell us what happened' },
]

/** Removes someone from every cached list once they're blocked. */
export function useForgetPerson() {
  const queryClient = useQueryClient()
  return (userId: number) => {
    queryClient.setQueryData<Match[]>(keys.matches, (list) => list?.filter((m) => m.user.id !== userId))
    void queryClient.invalidateQueries({ queryKey: keys.discover })
    void queryClient.invalidateQueries({ queryKey: keys.likes })
    void queryClient.invalidateQueries({ queryKey: keys.blocks })
  }
}

export function SafetyMenu({
  person,
  onUnmatch,
  onGone,
}: {
  person: PublicProfile
  onUnmatch?: () => void
  /** Called after they've been blocked or reported, e.g. to leave the chat. */
  onGone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const forget = useForgetPerson()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const block = useMutation({
    mutationFn: () => api.block(person.id),
    onSuccess: () => {
      forget(person.id)
      useToasts.getState().push({ title: `${person.name} is blocked`, body: "You won't see each other again." })
      onGone()
    },
  })

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-cream"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="size-5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            className="glass absolute top-12 right-0 z-30 w-60 overflow-hidden rounded-2xl border border-line-strong p-1.5 shadow-card"
          >
            {onUnmatch && (
              <MenuItem
                icon={<HeartCrack className="size-4" />}
                onClick={() => {
                  setOpen(false)
                  if (window.confirm(`Unmatch ${person.name}? This deletes the conversation for both of you.`)) {
                    onUnmatch()
                  }
                }}
              >
                Unmatch
              </MenuItem>
            )}
            <MenuItem
              icon={<Ban className="size-4" />}
              onClick={() => {
                setOpen(false)
                if (window.confirm(`Block ${person.name}? You'll disappear from each other's Kindred.`)) {
                  block.mutate()
                }
              }}
            >
              Block {person.name}
            </MenuItem>
            <MenuItem
              icon={<Flag className="size-4" />}
              danger
              onClick={() => {
                setOpen(false)
                setReporting(true)
              }}
            >
              Report {person.name}
            </MenuItem>
          </motion.div>
        )}
      </AnimatePresence>
      <ReportDialog person={person} open={reporting} onClose={() => setReporting(false)} onReported={onGone} />
    </div>
  )
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: ReactNode
  children: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-raised',
        danger ? 'text-danger' : 'text-cream',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function ReportDialog({
  person,
  open,
  onClose,
  onReported,
}: {
  person: PublicProfile
  open: boolean
  onClose: () => void
  onReported: () => void
}) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [details, setDetails] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(true)
  const forget = useForgetPerson()

  const report = useMutation({
    mutationFn: () => api.report({ user_id: person.id, reason: reason!, details, block: alsoBlock }),
    onSuccess: () => {
      if (alsoBlock) forget(person.id)
      useToasts.getState().push({
        title: 'Thanks for telling us',
        body: 'Our team reviews every report. You did the right thing.',
      })
      onClose()
      setReason(null)
      setDetails('')
      if (alsoBlock) onReported()
    },
  })

  return (
    <Dialog open={open} onClose={onClose} title={`Report ${person.name}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (reason) report.mutate()
        }}
        className="space-y-5"
      >
        <div className="flex items-center gap-3">
          <Avatar src={person.photos[0]} name={person.name} size={44} />
          <p className="text-sm text-muted">
            Reports are private. {person.name} won't know it was you.
          </p>
        </div>
        <fieldset className="grid gap-2">
          <legend className="label">What's wrong?</legend>
          {REPORT_REASONS.map((option) => (
            <label
              key={option.value}
              className={clsx(
                'flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition',
                reason === option.value ? 'border-coral/60 bg-coral/10' : 'border-line hover:border-line-strong',
              )}
            >
              <input
                type="radio"
                name="reason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
                className="mt-1 accent-[var(--color-coral)]"
              />
              <span>
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="block text-xs text-muted">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="block">
          <span className="label">Anything else? (optional)</span>
          <textarea
            className="field min-h-20 resize-y"
            maxLength={1000}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="What happened, in your own words"
          />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={alsoBlock}
            onChange={(e) => setAlsoBlock(e.target.checked)}
            className="size-4 accent-[var(--color-coral)]"
          />
          Also block {person.name}
        </label>
        {report.isError && <p className="text-sm text-danger">{report.error.message}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!reason || report.isPending}>
            {report.isPending ? <Spinner className="size-4" /> : <Flag className="size-4" />} Send report
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function BlockedList() {
  const queryClient = useQueryClient()
  const blocks = useQuery({ queryKey: keys.blocks, queryFn: api.blocks })
  const unblock = useMutation({
    mutationFn: (userId: number) => api.unblock(userId),
    onSuccess: (_, userId) => {
      queryClient.setQueryData<PublicProfile[]>(keys.blocks, (list) => list?.filter((p) => p.id !== userId))
      void queryClient.invalidateQueries({ queryKey: keys.discover })
    },
  })

  if (blocks.isPending) return <Spinner className="text-coral" />
  if (!blocks.data?.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-faint">
        <ShieldCheck className="size-4" /> You haven't blocked anyone.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-line">
      {blocks.data.map((person) => (
        <li key={person.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <Avatar src={person.photos[0]} name={person.name} size={40} />
          <span className="flex-1 truncate font-semibold">{person.name}</span>
          <button
            type="button"
            className="btn-ghost py-2 text-xs"
            disabled={unblock.isPending && unblock.variables === person.id}
            onClick={() => unblock.mutate(person.id)}
          >
            Unblock
          </button>
        </li>
      ))}
    </ul>
  )
}
