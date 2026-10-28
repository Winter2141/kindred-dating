import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Heart, LogOut, MessageCircle, Sparkles, UserRound } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { api } from '@/lib/api'
import { keys, totalUnread } from '@/lib/cache'
import { useAuth } from '@/store/auth'
import { useLive, useToasts } from '@/store/live'
import { Avatar, Logo } from './ui'

function useBadges() {
  const matches = useQuery({ queryKey: keys.matches, queryFn: api.matches })
  const likes = useQuery({ queryKey: keys.likes, queryFn: api.likes })
  return { unread: totalUnread(matches.data), likes: likes.data?.length ?? 0 }
}

const NAV = [
  { to: '/app/discover', label: 'Discover', icon: Sparkles, badge: null },
  { to: '/app/likes', label: 'Likes', icon: Heart, badge: 'likes' },
  { to: '/app/matches', label: 'Chats', icon: MessageCircle, badge: 'unread' },
  { to: '/app/profile', label: 'Profile', icon: UserRound, badge: null },
] as const

function Badge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <span
      className={clsx(
        'grid h-5 min-w-5 place-items-center rounded-full bg-gradient-brand px-1.5 text-[11px] font-bold text-ink',
        className,
      )}
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}

function ConnectionDot() {
  const status = useLive((s) => s.status)
  const label =
    status === 'open' ? 'Live' : status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted" title="Real-time connection">
      <span
        className={clsx(
          'size-2 rounded-full',
          status === 'open' ? 'bg-mint animate-pulse-ring' : 'bg-apricot animate-pulse',
        )}
      />
      {label}
    </span>
  )
}

function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4 lg:top-6 lg:right-6 lg:left-auto lg:items-end">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96 }}
            className="pointer-events-auto w-full max-w-sm"
          >
            <Link
              to={toast.href ?? '#'}
              onClick={() => dismiss(toast.id)}
              className="glass flex items-center gap-3 rounded-2xl border border-line-strong p-3 pr-4 shadow-card"
            >
              <Avatar src={toast.image} name={toast.title} size={44} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{toast.title}</span>
                {toast.body && (
                  <span className="block truncate text-[13px] text-muted">{toast.body}</span>
                )}
              </span>
            </Link>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function AppShell() {
  const user = useAuth((s) => s.user)
  const signOut = useAuth((s) => s.signOut)
  const badges = useBadges()
  const location = useLocation()
  const inChat = /^\/app\/matches\/\d+/.test(location.pathname)

  return (
    <div className="ambient relative flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-line px-5 py-7 lg:flex">
        <Link to="/app/discover" className="px-3">
          <Logo />
        </Link>
        <nav className="mt-10 flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'group flex items-center gap-3.5 rounded-2xl px-3.5 py-3 text-[15px] font-semibold transition',
                  isActive
                    ? 'bg-raised text-cream shadow-card'
                    : 'text-muted hover:bg-raised/60 hover:text-cream',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={clsx('size-5', isActive && 'text-coral')}
                    strokeWidth={isActive ? 2.4 : 2}
                  />
                  {label}
                  {badge && <Badge count={badges[badge]} className="ml-auto" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-4">
          <div className="px-3">
            <ConnectionDot />
          </div>
          {user && (
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface/70 p-3">
              <Avatar src={user.photos[0]} name={user.name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-xs text-muted">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-raised hover:text-cream"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!inChat && (
          <header className="glass sticky top-0 z-30 flex items-center justify-between border-b border-line px-5 py-3.5 lg:hidden">
            <Logo />
            <ConnectionDot />
          </header>
        )}
        <main className={clsx('flex-1', !inChat && 'pb-24 lg:pb-0')}>
          <Outlet />
        </main>
      </div>

      {!inChat && (
        <nav className="glass fixed inset-x-3 bottom-3 z-40 flex justify-around rounded-[1.6rem] border border-line-strong px-2 py-2 shadow-card lg:hidden">
          {NAV.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'relative flex flex-1 flex-col items-center gap-1 rounded-2xl py-2 text-[11px] font-semibold transition',
                  isActive ? 'text-cream' : 'text-faint',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={clsx('size-[22px]', isActive && 'text-coral')} />
                  {label}
                  {badge && (
                    <Badge count={badges[badge]} className="absolute -top-0.5 left-1/2 ml-2" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}
      <Toaster />
    </div>
  )
}
