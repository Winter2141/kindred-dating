import { useQueryClient } from '@tanstack/react-query'
import { Keyboard } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { keys as cacheKeys } from '@/lib/cache'
import { GO_TO, SHORTCUT_GROUPS, createSequenceMatcher, isTyping, neighbour } from '@/lib/shortcuts'
import type { Match } from '@/lib/types'
import { Dialog } from './ui'

export function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-grid min-w-7 place-items-center rounded-lg border border-line-strong bg-raised px-1.5 py-0.5 font-sans text-xs font-semibold text-cream shadow-[0_2px_0_0_rgb(255_236_226_/_0.08)]">
      {children}
    </kbd>
  )
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" wide>
      <div className="grid gap-8 sm:grid-cols-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className={group.title === 'Chats' ? 'sm:col-span-2' : undefined}>
            <h3 className="label">{group.title}</h3>
            <dl className="space-y-2">
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.label} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-cream/90">{shortcut.label}</dt>
                  <dd className="flex shrink-0 items-center gap-1 text-faint">
                    {shortcut.keys.map((key, i) => (
                      <Fragment key={key}>
                        {i > 0 && <span className="text-xs">{shortcut.keys[0] === 'g' ? 'then' : '+'}</span>}
                        <Key>{key}</Key>
                      </Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

/** App-wide shortcuts: "?" for help, "g" + letter to move, "/" to search, Alt+↑/↓ in chats. */
export function useGlobalShortcuts(): { helpOpen: boolean; setHelpOpen: (open: boolean) => void } {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [helpOpen, setHelpOpen] = useState(false)
  const sequence = useMemo(() => createSequenceMatcher(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey) return
      const inChats = location.pathname.startsWith('/app/matches')

      if (e.altKey && inChats && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const matches = queryClient.getQueryData<Match[]>(cacheKeys.matches) ?? []
        const ids = matches.filter((m) => m.last_message && !m.archived).map((m) => m.id)
        const current = Number(location.pathname.split('/')[3]) || null
        const next = neighbour(ids, current, e.key === 'ArrowDown' ? 1 : -1)
        if (next !== undefined) {
          e.preventDefault()
          navigate(`/app/matches/${next}`)
        }
        return
      }
      if (e.altKey || isTyping(e.target)) return

      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
        return
      }
      if (e.key === '/' && inChats) {
        const search = document.querySelector<HTMLInputElement>('[data-shortcut="search"]')
        if (search) {
          e.preventDefault()
          search.focus()
        }
        return
      }
      const target = sequence(e.key)
      if (target) {
        e.preventDefault()
        navigate(GO_TO[target].path)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [location.pathname, navigate, queryClient, sequence])

  return { helpOpen, setHelpOpen }
}

export function ShortcutsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-raised hover:text-cream"
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts (?)"
    >
      <Keyboard className="size-4" />
    </button>
  )
}
