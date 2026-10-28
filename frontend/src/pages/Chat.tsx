import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Check, CheckCheck, HeartCrack, Info, SendHorizontal, Sparkles, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ProfileDetails } from '@/components/ProfileDetails'
import { Avatar, Photo, Spinner, TypingDots } from '@/components/ui'
import { api } from '@/lib/api'
import { clearUnread, keys, markPendingFailed, upsertMessage } from '@/lib/cache'
import type { Match, Message } from '@/lib/types'
import { clockTime, dayLabel, isSameDay, lastSeen, shortAgo } from '@/lib/time'
import { useRealtimeSend } from '@/realtime/RealtimeProvider'
import { useAuth } from '@/store/auth'
import { useLive } from '@/store/live'

const PAGE_SIZE = 50
const SEND_TIMEOUT_MS = 10_000
const TYPING_IDLE_MS = 3000

export function ChatPage() {
  const matchId = Number(useParams().matchId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useAuth((s) => s.user)
  const send = useRealtimeSend()
  const [showProfile, setShowProfile] = useState(false)

  const matches = useQuery({ queryKey: keys.matches, queryFn: api.matches })
  const cached = matches.data?.find((m) => m.id === matchId)
  const single = useQuery({
    queryKey: keys.match(matchId),
    queryFn: () => api.match(matchId),
    enabled: matches.isSuccess && !cached,
    retry: false,
  })
  const match: Match | undefined = cached ?? single.data
  const messages = useQuery({
    queryKey: keys.messages(matchId),
    queryFn: () => api.messages(matchId),
    enabled: Boolean(match),
  })
  const typingUser = useLive((s) => s.typing[matchId])
  const online = useLive((s) => (match ? s.online[match.user.id] : undefined)) ?? match?.user.is_online

  useEffect(() => {
    useLive.getState().setActiveMatch(matchId)
    return () => useLive.getState().setActiveMatch(null)
  }, [matchId])

  // Mark their messages as read whenever new ones show up while the chat is open.
  const unreadFromThem = messages.data?.some((m) => m.sender_id !== me?.id && !m.read_at && !m.pending)
  useEffect(() => {
    if (!unreadFromThem || document.visibilityState === 'hidden') return
    send({ type: 'read', match_id: matchId })
    queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) =>
      list?.map((m) => (m.sender_id !== me?.id && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m)),
    )
    queryClient.setQueryData<Match[]>(keys.matches, (list) => clearUnread(list, matchId))
  }, [unreadFromThem, matchId, me?.id, send, queryClient])

  const unmatch = useMutation({
    mutationFn: () => api.unmatch(matchId),
    onSuccess: () => {
      queryClient.setQueryData<Match[]>(keys.matches, (list) => list?.filter((m) => m.id !== matchId))
      navigate('/app/matches')
    },
  })

  const sendMessage = (body: string) => {
    if (!me) return
    const clientId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const optimistic: Message = {
      id: Number.MAX_SAFE_INTEGER,
      match_id: matchId,
      sender_id: me.id,
      body,
      created_at: new Date().toISOString(),
      read_at: null,
      pending: clientId,
    }
    queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => [...(list ?? []), optimistic])
    send({ type: 'message.send', match_id: matchId, body, client_id: clientId })
    setTimeout(() => {
      queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) =>
        list?.some((m) => m.pending === clientId) ? markPendingFailed(list, clientId) : list,
      )
    }, SEND_TIMEOUT_MS)
  }

  const retry = (message: Message) => {
    queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) =>
      list?.filter((m) => m.pending !== message.pending),
    )
    sendMessage(message.body)
  }

  if (matches.isPending || (!cached && single.isPending && matches.isSuccess)) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="text-coral" />
      </div>
    )
  }
  if (!match) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="font-display text-4xl">This match is gone</p>
          <p className="mt-2 text-sm text-muted">They may have unmatched.</p>
          <Link to="/app/matches" className="btn-secondary mt-6">
            Back to chats
          </Link>
        </div>
      </div>
    )
  }

  const other = match.user
  return (
    <div className="flex h-dvh lg:h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass z-10 flex items-center gap-3 border-b border-line px-3 py-3 sm:px-5">
          <Link
            to="/app/matches"
            className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-cream lg:hidden"
            aria-label="Back to chats"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <button
            type="button"
            onClick={() => setShowProfile((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <Avatar src={other.photos[0]} name={other.name} size={44} online={online} />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{other.name}</span>
              <span className={clsx('block truncate text-xs', typingUser ? 'text-coral' : online ? 'text-mint' : 'text-muted')}>
                {typingUser ? 'typing…' : lastSeen(other.last_active_at, Boolean(online))}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShowProfile((v) => !v)}
            className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-cream"
            aria-label="View profile"
            title="View profile"
          >
            <Info className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Unmatch ${other.name}? This deletes the conversation for both of you.`)) {
                unmatch.mutate()
              }
            }}
            className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-rose"
            aria-label="Unmatch"
            title="Unmatch"
          >
            <HeartCrack className="size-5" />
          </button>
        </header>

        <MessageList
          match={match}
          messages={messages.data}
          loading={messages.isPending}
          meId={me?.id ?? -1}
          typing={typingUser !== undefined}
          onRetry={retry}
          onIcebreaker={sendMessage}
        />
        <Composer matchId={matchId} onSend={sendMessage} name={other.name} />
      </div>

      <AnimatePresence>
        {showProfile && (
          <motion.aside
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed inset-0 z-40 overflow-y-auto bg-surface xl:static xl:w-[380px] xl:shrink-0 xl:border-l xl:border-line"
          >
            <div className="relative h-80 [container-type:inline-size]">
              <Photo src={other.photos[0]} name={other.name} className="size-full" />
              <div className="absolute inset-0 bg-gradient-to-t from-surface to-transparent to-60%" />
              <button
                type="button"
                onClick={() => setShowProfile(false)}
                className="glass absolute top-4 right-4 grid size-10 place-items-center rounded-full border border-line-strong"
                aria-label="Close profile"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="-mt-10 px-7 pb-10">
              <ProfileDetails profile={{ ...other, is_online: Boolean(online) }} shared={me?.interests} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}

function MessageList({
  match,
  messages,
  loading,
  meId,
  typing,
  onRetry,
  onIcebreaker,
}: {
  match: Match
  messages: Message[] | undefined
  loading: boolean
  meId: number
  typing: boolean
  onRetry: (message: Message) => void
  onIcebreaker: (text: string) => void
}) {
  const queryClient = useQueryClient()
  const scroller = useRef<HTMLDivElement>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [reachedStart, setReachedStart] = useState(false)
  const stickToBottom = useRef(true)
  const list = messages ?? []

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [list.length, typing])

  const loadOlder = async () => {
    const first = list.find((m) => !m.pending)
    if (!first) return
    const el = scroller.current
    const previousHeight = el?.scrollHeight ?? 0
    setLoadingOlder(true)
    stickToBottom.current = false
    const older = await api.messages(match.id, first.id)
    queryClient.setQueryData<Message[]>(keys.messages(match.id), (current) =>
      older.reduce((acc, message) => upsertMessage(acc, message), current ?? []),
    )
    setReachedStart(older.length < PAGE_SIZE)
    setLoadingOlder(false)
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - previousHeight
    })
  }

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      }}
      className="flex-1 overflow-y-auto px-4 py-6 sm:px-8"
    >
      {loading ? (
        <div className="grid h-full place-items-center">
          <Spinner className="text-coral" />
        </div>
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col">
          {list.length >= PAGE_SIZE && !reachedStart && (
            <button
              type="button"
              onClick={loadOlder}
              className="btn-ghost mx-auto mb-4 text-xs"
              disabled={loadingOlder}
            >
              {loadingOlder ? <Spinner className="size-4" /> : 'Load earlier messages'}
            </button>
          )}

          <MatchedBanner match={match} empty={list.length === 0} onIcebreaker={onIcebreaker} />

          {list.map((message, index) => {
            const previous = list[index - 1]
            const next = list[index + 1]
            const mine = message.sender_id === meId
            const newDay = !previous || !isSameDay(previous.created_at, message.created_at)
            const groupedWithNext =
              next && next.sender_id === message.sender_id && isSameDay(next.created_at, message.created_at)
            const groupedWithPrevious =
              previous && !newDay && previous.sender_id === message.sender_id
            return (
              <Fragment key={message.pending ?? message.id}>
                {newDay && (
                  <div className="my-5 flex items-center gap-4 text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">
                    <span className="h-px flex-1 bg-line" />
                    {dayLabel(message.created_at)}
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.18 }}
                  className={clsx(
                    'flex flex-col',
                    mine ? 'items-end' : 'items-start',
                    groupedWithPrevious ? 'mt-1' : 'mt-3',
                  )}
                >
                  <div
                    className={clsx(
                      'max-w-[78%] px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap sm:max-w-[65%]',
                      mine
                        ? 'rounded-[1.4rem] rounded-br-md bg-gradient-brand text-ink'
                        : 'rounded-[1.4rem] rounded-bl-md border border-line bg-raised',
                      mine && groupedWithPrevious && 'rounded-tr-md',
                      !mine && groupedWithPrevious && 'rounded-tl-md',
                      message.pending && !message.failed && 'opacity-70',
                      message.failed && 'opacity-60 ring-2 ring-danger',
                    )}
                  >
                    {message.body}
                  </div>
                  {!groupedWithNext && (
                    <span className="mt-1.5 flex items-center gap-1 px-1 text-[11px] text-faint">
                      {message.failed ? (
                        <button type="button" onClick={() => onRetry(message)} className="font-semibold text-danger hover:underline">
                          Not sent · Tap to retry
                        </button>
                      ) : message.pending ? (
                        'Sending…'
                      ) : (
                        <>
                          {clockTime(message.created_at)}
                          {mine &&
                            (message.read_at ? (
                              <CheckCheck className="size-3.5 text-sky" aria-label="Read" />
                            ) : (
                              <Check className="size-3.5" aria-label="Sent" />
                            ))}
                        </>
                      )}
                    </span>
                  )}
                </motion.div>
              </Fragment>
            )
          })}

          <AnimatePresence>
            {typing && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3 flex items-end gap-2"
              >
                <Avatar src={match.user.photos[0]} name={match.user.name} size={26} />
                <span className="rounded-[1.4rem] rounded-bl-md border border-line bg-raised px-4 py-3.5 text-muted">
                  <TypingDots />
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function MatchedBanner({
  match,
  empty,
  onIcebreaker,
}: {
  match: Match
  empty: boolean
  onIcebreaker: (text: string) => void
}) {
  const icebreakers = useQuery({
    queryKey: keys.icebreakers(match.id),
    queryFn: () => api.icebreakers(match.id),
    enabled: empty,
    staleTime: Infinity,
  })
  return (
    <div className="mb-4 flex flex-col items-center py-6 text-center">
      <Avatar src={match.user.photos[0]} name={match.user.name} size={88} ring />
      <p className="mt-4 font-display text-3xl">You matched with {match.user.name}</p>
      <p className="mt-1 text-sm text-muted">{shortAgo(match.created_at) === 'now' ? 'Just now' : `${shortAgo(match.created_at)} ago`}</p>
      {empty && icebreakers.data && (
        <div className="mt-7 w-full max-w-md space-y-2.5">
          <p className="flex items-center justify-center gap-2 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
            <Sparkles className="size-3.5 text-apricot" /> Icebreakers for you two
          </p>
          {icebreakers.data.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => onIcebreaker(idea)}
              className="block w-full rounded-2xl border border-line bg-raised/70 px-4 py-3 text-left text-sm text-cream/90 transition hover:border-coral/50 hover:bg-raised"
            >
              {idea}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Composer({ matchId, name, onSend }: { matchId: number; name: string; onSend: (body: string) => void }) {
  const send = useRealtimeSend()
  const [text, setText] = useState('')
  const typingRef = useRef(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const textarea = useRef<HTMLTextAreaElement>(null)

  const setTyping = (isTyping: boolean) => {
    if (typingRef.current === isTyping) return
    typingRef.current = isTyping
    send({ type: 'typing', match_id: matchId, is_typing: isTyping })
  }

  useEffect(() => {
    return () => {
      clearTimeout(idleTimer.current)
      if (typingRef.current) send({ type: 'typing', match_id: matchId, is_typing: false })
      typingRef.current = false
    }
  }, [matchId, send])

  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const submit = () => {
    const body = text.trim()
    if (!body) return
    onSend(body)
    setText('')
    clearTimeout(idleTimer.current)
    setTyping(false)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="border-t border-line px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6"
    >
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[1.6rem] border border-line bg-raised/70 p-1.5 pl-5 transition focus-within:border-coral/50">
        <textarea
          ref={textarea}
          value={text}
          rows={1}
          maxLength={2000}
          onChange={(e) => {
            setText(e.target.value)
            setTyping(e.target.value.trim().length > 0)
            clearTimeout(idleTimer.current)
            idleTimer.current = setTimeout(() => setTyping(false), TYPING_IDLE_MS)
          }}
          onBlur={() => setTyping(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={`Message ${name}…`}
          aria-label={`Message ${name}`}
          className="max-h-40 flex-1 resize-none bg-transparent py-2.5 text-[15px] text-cream outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-ink shadow-glow transition hover:brightness-110 disabled:bg-none disabled:bg-surface disabled:text-faint disabled:shadow-none"
          aria-label="Send"
        >
          <SendHorizontal className="size-5" />
        </button>
      </div>
    </form>
  )
}
