import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, CheckCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
  notificationText,
} from '@/lib/notifications'
import { shortAgo } from '@/lib/time'
import type { AppNotification, NotificationList } from '@/lib/types'
import { Avatar, Spinner } from './ui'

export function useNotifications() {
  return useQuery({ queryKey: keys.notifications, queryFn: api.notifications })
}

export function NotificationBell({ align = 'left' }: { align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const feed = useNotifications()
  const unread = feed.data?.unread ?? 0

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-10 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-cream"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-gradient-brand px-1 text-[11px] font-bold text-ink">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className={clsx(
              'glass fixed inset-x-3 top-16 z-50 overflow-hidden rounded-3xl border border-line-strong shadow-card sm:absolute sm:inset-x-auto sm:top-12 sm:w-96',
              align === 'right' ? 'sm:right-0' : 'sm:left-0',
            )}
          >
            <NotificationPanel feed={feed.data} loading={feed.isPending} onNavigate={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function NotificationPanel({
  feed,
  loading,
  onNavigate,
}: {
  feed: NotificationList | undefined
  loading: boolean
  onNavigate: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const readAll = useMutation({
    mutationFn: api.readAllNotifications,
    onMutate: () =>
      queryClient.setQueryData<NotificationList>(keys.notifications, (f) =>
        markAllNotificationsRead(f, new Date().toISOString()),
      ),
  })
  const readOne = useMutation({
    mutationFn: (id: number) => api.readNotification(id),
    onMutate: (id) =>
      queryClient.setQueryData<NotificationList>(keys.notifications, (f) =>
        markNotificationRead(f, id, new Date().toISOString()),
      ),
  })

  const open = (n: AppNotification) => {
    if (!n.read_at) readOne.mutate(n.id)
    onNavigate()
    navigate(notificationHref(n))
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="font-display text-2xl">Notifications</h2>
        {(feed?.unread ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => readAll.mutate()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-coral hover:underline"
          >
            <CheckCheck className="size-3.5" /> Mark all read
          </button>
        )}
      </div>
      <div className="max-h-[60dvh] overflow-y-auto p-2">
        {loading ? (
          <div className="grid place-items-center py-10">
            <Spinner className="text-coral" />
          </div>
        ) : feed?.items.length ? (
          <ul>
            {feed.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={clsx(
                    'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-raised',
                    !n.read_at && 'bg-raised/50',
                  )}
                >
                  <Avatar src={n.actor?.photos[0]} name={n.actor?.name ?? '?'} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className={clsx('block text-sm', n.read_at ? 'text-cream/80' : 'font-semibold')}>
                      {notificationText(n)}
                    </span>
                    {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                    <span className="block text-[11px] text-faint">{shortAgo(n.created_at)} ago</span>
                  </span>
                  {!n.read_at && <span className="size-2.5 shrink-0 rounded-full bg-coral" aria-label="Unread" />}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-muted">
            Nothing yet. Likes, matches and messages you miss will show up here.
          </p>
        )}
      </div>
    </div>
  )
}
