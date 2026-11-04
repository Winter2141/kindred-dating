import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ImagePlus,
  Info,
  Phone,
  PhoneMissed,
  SendHorizontal,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ProfileDetails } from '@/components/ProfileDetails'
import { DateBar, PlanDateButton } from '@/components/DatePlanner'
import { Lightbox } from '@/components/Lightbox'
import { KindnessNudge, useKindnessCheck } from '@/components/Kindness'
import { EditBanner, MessageMenu, lastEditable } from '@/components/MessageActions'
import { ReactionChips, ReactionPicker } from '@/components/Reactions'
import {
  QuoteBlock,
  ReplyBanner,
  ReplyButton,
  SWIPE_TO_REPLY_PX,
  jumpToMessage,
  quoteOf,
} from '@/components/Replies'
import { SafetyMenu } from '@/components/Safety'
import { VerifiedBadge } from '@/components/Verification'
import { RecordButton, RecordingBar, VoicePlayer } from '@/components/VoiceNotes'
import { Avatar, Photo, Spinner, TypingDots } from '@/components/ui'
import { api } from '@/lib/api'
import {
  applyEdit,
  applyEditToMatches,
  applyReaction,
  applyUnsend,
  applyUnsendToMatches,
  clearUnread,
  keys,
  markPendingFailed,
  upsertMessage,
} from '@/lib/cache'
import type { Match, Message, QuotedMessage } from '@/lib/types'
import { describeCallRecord, startCall } from '@/lib/calls'
import { photoProblem } from '@/lib/photos'
import { useVoiceRecorder, type Recording } from '@/lib/voice'
import { clockTime, dayLabel, isSameDay, lastSeen, shortAgo } from '@/lib/time'
import { useRealtimeSend } from '@/realtime/RealtimeProvider'
import { useAuth } from '@/store/auth'
import { useLive, useToasts } from '@/store/live'

const PAGE_SIZE = 50
/** How far back opening a chat at a search result will page to find the message. */
const MAX_PAGES_TO_FIND = 20

/** A temporary id for a message until the server confirms it. */
function newClientId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
const SEND_TIMEOUT_MS = 10_000
const TYPING_IDLE_MS = 3000

export function ChatPage() {
  const matchId = Number(useParams().matchId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useAuth((s) => s.user)
  const send = useRealtimeSend()
  const [showProfile, setShowProfile] = useState(false)
  const [replyingTo, setReplyingTo] = useState<QuotedMessage | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  // A reply or edit in progress belongs to its conversation; switching chats drops it.
  const [draftMatchId, setDraftMatchId] = useState(matchId)
  if (draftMatchId !== matchId) {
    setDraftMatchId(matchId)
    setReplyingTo(null)
    setEditing(null)
  }

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
  // ?message=123 (from search) opens the chat scrolled to that message, paging back if needed.
  const [searchParams, setSearchParams] = useSearchParams()
  const target = Number(searchParams.get('message')) || null
  const messagesLoaded = messages.isSuccess
  useEffect(() => {
    if (!target || !messagesLoaded) return
    let cancelled = false
    const reveal = async () => {
      let list = queryClient.getQueryData<Message[]>(keys.messages(matchId)) ?? []
      for (let page = 0; page < MAX_PAGES_TO_FIND && !list.some((m) => m.id === target); page++) {
        const first = list.find((m) => !m.pending)
        if (!first) break
        const older = await api.messages(matchId, first.id)
        if (cancelled) return
        list = older.reduce((acc, message) => upsertMessage(acc, message), list)
        queryClient.setQueryData(keys.messages(matchId), list)
        if (older.length < PAGE_SIZE) break
      }
      // Let the older pages render before scrolling to the message.
      setTimeout(() => {
        if (cancelled) return
        jumpToMessage(target)
        setSearchParams(
          (params) => {
            params.delete('message')
            return params
          },
          { replace: true },
        )
      }, 120)
    }
    void reveal()
    return () => {
      cancelled = true
    }
  }, [target, messagesLoaded, matchId, queryClient, setSearchParams])

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

  const sendMessage = (body: string, replyTo: QuotedMessage | null = null) => {
    if (!me) return
    const clientId = newClientId('c')
    const optimistic: Message = {
      id: Number.MAX_SAFE_INTEGER,
      match_id: matchId,
      sender_id: me.id,
      body,
      reply_to: replyTo,
      created_at: new Date().toISOString(),
      read_at: null,
      pending: clientId,
    }
    queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => [...(list ?? []), optimistic])
    send({ type: 'message.send', match_id: matchId, body, client_id: clientId, reply_to_id: replyTo?.id ?? null })
    setTimeout(() => {
      queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) =>
        list?.some((m) => m.pending === clientId) ? markPendingFailed(list, clientId) : list,
      )
    }, SEND_TIMEOUT_MS)
  }

  const react = (message: Message, emoji: string) => {
    if (!me || message.pending) return
    const current = message.reactions?.find((r) => r.user_id === me.id)?.emoji ?? null
    const next = current === emoji ? null : emoji
    queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) =>
      applyReaction(list, message.id, me.id, next),
    )
    send({ type: 'react', match_id: matchId, message_id: message.id, emoji: next })
  }

  const unsend = useMutation({
    mutationFn: (message: Message) => api.unsend(matchId, message.id),
    onSuccess: (message) => {
      const deletedAt = message.deleted_at ?? new Date().toISOString()
      queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => applyUnsend(list, message.id, deletedAt))
      queryClient.setQueryData<Match[]>(keys.matches, (list) => applyUnsendToMatches(list, message.id, deletedAt))
    },
    onError: (error) => useToasts.getState().push({ title: "Couldn't unsend", body: error.message }),
  })

  const edit = useMutation({
    mutationFn: ({ message, body }: { message: Message; body: string }) => api.editMessage(matchId, message.id, body),
    onMutate: ({ message, body }) => {
      // Show the new text straight away; put the old one back if the server says no.
      const draft = { id: message.id, body, edited_at: new Date().toISOString() }
      queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => applyEdit(list, draft))
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => applyEdit(list, saved))
      queryClient.setQueryData<Match[]>(keys.matches, (list) => applyEditToMatches(list, saved))
    },
    onError: (error, { message }) => {
      queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => applyEdit(list, message))
      useToasts.getState().push({ title: "Couldn't edit", body: error.message })
    },
  })

  const startEdit = (message: Message) => {
    setReplyingTo(null)
    setEditing(message)
  }

  // Uploads still in flight (or failed), so "Tap to retry" can send them again.
  const pendingUploads = useRef(new Map<string, () => void>())

  const sendPhoto = async (file: File, caption: string, replyTo: QuotedMessage | null = null) => {
    if (!me) return
    const clientId = newClientId('p')
    pendingUploads.current.set(clientId, () => void sendPhoto(file, caption, replyTo))
    const optimistic: Message = {
      id: Number.MAX_SAFE_INTEGER,
      match_id: matchId,
      sender_id: me.id,
      body: caption,
      image_url: URL.createObjectURL(file),
      reply_to: replyTo,
      created_at: new Date().toISOString(),
      read_at: null,
      pending: clientId,
    }
    queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => [...(list ?? []), optimistic])
    try {
      const sent = await api.sendPhoto(matchId, file, caption, replyTo?.id)
      queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => upsertMessage(list, sent, clientId))
      pendingUploads.current.delete(clientId)
      URL.revokeObjectURL(optimistic.image_url!)
    } catch (error) {
      queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => markPendingFailed(list, clientId))
      useToasts.getState().push({ title: "Photo didn't send", body: (error as Error).message })
    }
  }

  const sendVoice = async (recording: Recording, replyTo: QuotedMessage | null = null) => {
    if (!me) return
    const clientId = newClientId('v')
    pendingUploads.current.set(clientId, () => void sendVoice(recording, replyTo))
    const optimistic: Message = {
      id: Number.MAX_SAFE_INTEGER,
      match_id: matchId,
      sender_id: me.id,
      body: '',
      audio_url: URL.createObjectURL(recording.blob),
      audio_ms: recording.durationMs,
      waveform: recording.waveform,
      reply_to: replyTo,
      created_at: new Date().toISOString(),
      read_at: null,
      pending: clientId,
    }
    queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => [...(list ?? []), optimistic])
    try {
      const sent = await api.sendVoice(matchId, recording.blob, recording.durationMs, recording.waveform, replyTo?.id)
      queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => upsertMessage(list, sent, clientId))
      pendingUploads.current.delete(clientId)
      URL.revokeObjectURL(optimistic.audio_url!)
    } catch (error) {
      queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) => markPendingFailed(list, clientId))
      useToasts.getState().push({ title: "Voice note didn't send", body: (error as Error).message })
    }
  }

  const retry = (message: Message) => {
    queryClient.setQueryData<Message[]>(keys.messages(matchId), (list) =>
      list?.filter((m) => m.pending !== message.pending),
    )
    const again = message.pending ? pendingUploads.current.get(message.pending) : undefined
    if (again && message.pending) {
      pendingUploads.current.delete(message.pending)
      again()
    } else {
      sendMessage(message.body, message.reply_to ?? null)
    }
  }

  const jump = (messageId: number) => {
    if (!jumpToMessage(messageId)) {
      useToasts.getState().push({ title: 'That message is further back', body: 'Load earlier messages to see it.' })
    }
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
  const callPeer = { id: other.id, name: other.name, photo: other.photos[0] ?? null }
  return (
    <div className="flex h-dvh lg:h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass z-10 flex items-center gap-1.5 border-b border-line px-3 py-3 sm:gap-3 sm:px-5">
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
              <span className="flex items-center gap-1.5 font-semibold">
                <span className="truncate">{other.name}</span>
                {other.verified && <VerifiedBadge className="size-4" />}
              </span>
              <span className={clsx('block truncate text-xs', typingUser ? 'text-coral' : online ? 'text-mint' : 'text-muted')}>
                {typingUser ? 'typing…' : lastSeen(other.last_active_at, Boolean(online))}
              </span>
            </span>
          </button>
          {/* Phones open the profile by tapping the name, so the header keeps room for it. */}
          <button
            type="button"
            onClick={() => setShowProfile((v) => !v)}
            className="hidden size-10 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-cream sm:grid"
            aria-label="View profile"
            title="View profile"
          >
            <Info className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => void startCall(match.id, callPeer, 'audio')}
            className="hidden size-10 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-cream sm:grid"
            aria-label={`Call ${other.name}`}
            title="Audio call"
          >
            <Phone className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => void startCall(match.id, callPeer, 'video')}
            className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-cream"
            aria-label={`Video call ${other.name}`}
            title="Video call"
          >
            <Video className="size-5" />
          </button>
          <PlanDateButton match={match} />
          <SafetyMenu person={other} onUnmatch={() => unmatch.mutate()} onGone={() => navigate('/app/matches')} />
        </header>
        <DateBar match={match} meId={me?.id ?? -1} />

        <MessageList
          match={match}
          messages={messages.data}
          loading={messages.isPending}
          meId={me?.id ?? -1}
          typing={typingUser !== undefined}
          onRetry={retry}
          onReact={react}
          onUnsend={(message) => unsend.mutate(message)}
          onReply={(message) => {
            setEditing(null)
            setReplyingTo(quoteOf(message))
          }}
          onEdit={startEdit}
          onJump={jump}
          onIcebreaker={(text) => sendMessage(text)}
        />
        <Composer
          matchId={matchId}
          onSend={(body) => {
            sendMessage(body, replyingTo)
            setReplyingTo(null)
          }}
          onSendPhoto={(file, caption) => {
            void sendPhoto(file, caption, replyingTo)
            setReplyingTo(null)
          }}
          onSendVoice={(recording) => {
            void sendVoice(recording, replyingTo)
            setReplyingTo(null)
          }}
          name={other.name}
          reply={
            replyingTo && (
              <ReplyBanner
                quote={replyingTo}
                meId={me?.id ?? -1}
                otherName={other.name}
                onCancel={() => setReplyingTo(null)}
              />
            )
          }
          onCancelReply={replyingTo ? () => setReplyingTo(null) : undefined}
          editing={editing}
          onSaveEdit={(body) => {
            if (editing && body !== editing.body) edit.mutate({ message: editing, body })
            setEditing(null)
          }}
          onCancelEdit={() => setEditing(null)}
          onEditLast={() => {
            const last = lastEditable(messages.data, me?.id ?? -1)
            if (last) startEdit(last)
          }}
        />
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
  onReact,
  onUnsend,
  onReply,
  onEdit,
  onJump,
  onIcebreaker,
}: {
  match: Match
  messages: Message[] | undefined
  loading: boolean
  meId: number
  typing: boolean
  onRetry: (message: Message) => void
  onReact: (message: Message, emoji: string) => void
  onUnsend: (message: Message) => void
  onReply: (message: Message) => void
  onEdit: (message: Message) => void
  onJump: (messageId: number) => void
  onIcebreaker: (text: string) => void
}) {
  // Swiping a bubble sideways starts a reply, on touch screens only so mouse users can select text.
  const [touch] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)
  const queryClient = useQueryClient()
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [reachedStart, setReachedStart] = useState(false)
  const stickToBottom = useRef(true)
  const list = messages ?? []

  const keepAtBottom = () => {
    const el = scroller.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }
  // Photos change height when they finish loading, so they call keepAtBottom too.
  useLayoutEffect(keepAtBottom, [list.length, typing])

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
                {message.call_kind ? (
                  <CallRecord message={message} mine={mine} />
                ) : (
                  <motion.div
                    id={message.pending ? undefined : `message-${message.id}`}
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.18 }}
                    drag={touch && !message.pending && !message.deleted_at ? 'x' : false}
                    dragDirectionLock
                    dragSnapToOrigin
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={{ left: 0, right: 0.35 }}
                    onDragEnd={(_, info) => info.offset.x > SWIPE_TO_REPLY_PX && onReply(message)}
                    className={clsx(
                      'flex flex-col',
                      mine ? 'items-end' : 'items-start',
                      groupedWithPrevious ? 'mt-1' : 'mt-3',
                    )}
                  >
                    <div
                      className={clsx(
                        'group flex max-w-[88%] items-center gap-1 sm:max-w-[72%]',
                        mine && 'flex-row-reverse',
                      )}
                    >
                      {message.deleted_at ? (
                        <div className="rounded-[1.4rem] border border-dashed border-line-strong px-4 py-2.5 text-sm text-faint italic">
                          {mine ? 'You unsent a message' : 'Message unsent'}
                        </div>
                      ) : (
                        <div
                          onDoubleClick={() => !message.pending && onReact(message, '❤️')}
                          className={clsx(
                            'min-w-0 text-[15px] leading-relaxed break-words whitespace-pre-wrap',
                            message.image_url ? 'p-1.5' : message.audio_url ? 'px-3 py-2' : 'px-4 py-2.5',
                            mine
                              ? 'rounded-[1.4rem] rounded-br-md bg-gradient-brand text-ink'
                              : 'rounded-[1.4rem] rounded-bl-md border border-line bg-raised',
                            mine && groupedWithPrevious && 'rounded-tr-md',
                            !mine && groupedWithPrevious && 'rounded-tl-md',
                            message.pending && !message.failed && 'opacity-70',
                            message.failed && 'opacity-60 ring-2 ring-danger',
                          )}
                        >
                          {message.reply_to && (
                            <QuoteBlock
                              quote={message.reply_to}
                              meId={meId}
                              otherName={match.user.name}
                              mine={mine}
                              onJump={onJump}
                            />
                          )}
                          {message.audio_url ? (
                            <VoicePlayer
                              src={message.audio_url}
                              durationMs={message.audio_ms ?? 0}
                              waveform={message.waveform}
                              mine={mine}
                            />
                          ) : message.image_url ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setViewing(message.image_url!)}
                                className="block overflow-hidden rounded-[1.1rem]"
                                aria-label="Open photo"
                              >
                                <img
                                  src={message.image_url}
                                  alt={message.body || 'Photo'}
                                  loading="lazy"
                                  onLoad={keepAtBottom}
                                  className="max-h-80 w-full max-w-72 object-cover"
                                />
                              </button>
                              {message.body && (
                                <p className="px-2.5 pt-1.5 pb-1">
                                  {message.body}
                                  {message.edited_at && <EditedLabel />}
                                </p>
                              )}
                            </>
                          ) : (
                            <>
                              {message.body}
                              {message.edited_at && <EditedLabel />}
                            </>
                          )}
                        </div>
                      )}
                      {!message.pending && !message.deleted_at && (
                        <>
                          <ReactionPicker
                            open={pickerFor === message.id}
                            onOpenChange={(open) => setPickerFor(open ? message.id : null)}
                            onPick={(emoji) => onReact(message, emoji)}
                            align={mine ? 'right' : 'left'}
                          />
                          <ReplyButton onReply={() => onReply(message)} />
                          <MessageMenu
                            message={message}
                            meId={meId}
                            onUnsend={onUnsend}
                            onReply={onReply}
                            onEdit={onEdit}
                            align={mine ? 'right' : 'left'}
                          />
                        </>
                      )}
                    </div>
                    <ReactionChips
                      reactions={message.reactions}
                      meId={meId}
                      onToggle={(emoji) => onReact(message, emoji)}
                      align={mine ? 'right' : 'left'}
                    />
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
                )}
              </Fragment>
            )
          })}

          <Lightbox src={viewing} alt="Photo" onClose={() => setViewing(null)} />

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

/** A call in the conversation's history, centred like the day dividers. */
function CallRecord({ message, mine }: { message: Message; mine: boolean }) {
  const kind = message.call_kind === 'audio' ? 'audio' : 'video'
  const missed = message.call_ms == null
  const Icon = missed && !mine ? PhoneMissed : kind === 'video' ? Video : Phone
  return (
    <div id={`message-${message.id}`} className="my-3 flex justify-center">
      <span
        className={clsx(
          'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm',
          missed && !mine ? 'border-danger/30 bg-danger/10 text-danger' : 'border-line bg-raised/70 text-muted',
        )}
      >
        <Icon className="size-4" />
        {describeCallRecord(kind, message.call_ms ?? null, mine)}
        <span className="text-xs text-faint">{clockTime(message.created_at)}</span>
      </span>
    </div>
  )
}

function EditedLabel() {
  return <span className="ml-1.5 align-baseline text-[11px] opacity-60 select-none">edited</span>
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

function Composer({
  matchId,
  name,
  onSend,
  onSendPhoto,
  onSendVoice,
  reply,
  onCancelReply,
  editing,
  onSaveEdit,
  onCancelEdit,
  onEditLast,
}: {
  matchId: number
  name: string
  onSend: (body: string) => void
  onSendPhoto: (file: File, caption: string) => void
  onSendVoice: (recording: Recording) => void
  /** The quote of the message being answered, shown above the input. */
  reply?: ReactNode
  onCancelReply?: () => void
  /** A message of mine being edited: the input holds its text and saving replaces it. */
  editing?: Message | null
  onSaveEdit?: (body: string) => void
  onCancelEdit?: () => void
  /** ↑ in an empty input edits my last message. */
  onEditLast?: () => void
}) {
  const send = useRealtimeSend()
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  const typingRef = useRef(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const recorder = useVoiceRecorder(onSendVoice)
  const recording = recorder.state === 'recording'
  const checkKindness = useKindnessCheck()
  // What looked unkind in the draft the person just tried to send; non-empty opens the nudge.
  const [nudge, setNudge] = useState<string[]>([])

  useEffect(() => {
    if (recorder.state === 'unavailable') {
      useToasts.getState().push({
        title: "Can't record",
        body: 'Allow microphone access for Kindred in your browser to send voice notes.',
      })
    }
  }, [recorder.state])

  const sendRecording = async () => {
    const result = await recorder.stop()
    if (result) onSendVoice(result)
    else useToasts.getState().push({ title: 'Too short', body: 'Hold on a little longer to record a voice note.' })
  }

  // Load the message's text when editing starts, and clear it when editing ends.
  const editingId = editing?.id ?? null
  const [loadedEditId, setLoadedEditId] = useState<number | null>(null)
  if (editingId !== loadedEditId) {
    setLoadedEditId(editingId)
    setText(editing ? editing.body : '')
    setPhoto(null)
  }

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

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

  const replying = Boolean(reply)
  useEffect(() => {
    if (replying || editingId !== null) textarea.current?.focus()
  }, [replying, editingId])

  const pick = (file: File | undefined) => {
    if (!file) return
    const issue = photoProblem(file)
    setProblem(issue)
    setPhoto(issue ? null : file)
    textarea.current?.focus()
  }

  const submit = (sendAnyway = false) => {
    const body = text.trim()
    if (!sendAnyway && body) {
      const phrases = checkKindness(body)
      if (phrases.length > 0) {
        setNudge(phrases)
        return
      }
    }
    if (editing) {
      if (!body && !editing.image_url) return
      onSaveEdit?.(body)
      return
    }
    if (photo) onSendPhoto(photo, body)
    else if (body) onSend(body)
    else return
    setText('')
    setPhoto(null)
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
      {editing && onCancelEdit ? <EditBanner message={editing} onCancel={onCancelEdit} /> : reply}
      <KindnessNudge
        phrases={nudge}
        name={name}
        onEdit={() => {
          setNudge([])
          textarea.current?.focus()
        }}
        onSendAnyway={() => {
          setNudge([])
          submit(true)
        }}
      />
      {(preview || problem) && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3">
          {preview && (
            <div className="relative">
              <img src={preview} alt="Photo to send" className="size-16 rounded-2xl object-cover" />
              <button
                type="button"
                onClick={() => setPhoto(null)}
                className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border border-line-strong bg-raised text-muted hover:text-cream"
                aria-label="Remove photo"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <p className={clsx('text-xs', problem ? 'text-danger' : 'text-faint')}>
            {problem ?? 'Add a caption, or just hit send.'}
          </p>
        </div>
      )}
      {recording ? (
        <RecordingBar
          elapsedMs={recorder.elapsedMs}
          levels={recorder.levels}
          onCancel={recorder.cancel}
          onSend={() => void sendRecording()}
        />
      ) : (
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[1.6rem] border border-line bg-raised/70 p-1.5 pl-2 transition focus-within:border-coral/50">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={Boolean(editing)}
            className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface hover:text-cream disabled:opacity-40"
            aria-label="Attach a photo"
            title="Attach a photo"
          >
            <ImagePlus className="size-5" />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic"
            className="hidden"
            aria-label="Photo to send"
            onChange={(e) => {
              pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <textarea
            ref={textarea}
            value={text}
            rows={1}
            maxLength={photo ? 500 : 2000}
            onChange={(e) => {
              setText(e.target.value)
              setTyping(e.target.value.trim().length > 0)
              clearTimeout(idleTimer.current)
              idleTimer.current = setTimeout(() => setTyping(false), TYPING_IDLE_MS)
            }}
            onBlur={() => setTyping(false)}
            onPaste={(e) => {
              const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
              if (file) {
                e.preventDefault()
                pick(file)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              } else if (e.key === 'Escape' && editing && onCancelEdit) {
                e.preventDefault()
                onCancelEdit()
              } else if (e.key === 'Escape' && onCancelReply) {
                e.preventDefault()
                onCancelReply()
              } else if (e.key === 'ArrowUp' && !text && !photo && !editing && onEditLast) {
                e.preventDefault()
                onEditLast()
              }
            }}
            placeholder={editing ? 'Edit your message…' : photo ? 'Add a caption…' : `Message ${name}…`}
            aria-label={`Message ${name}`}
            className="max-h-40 flex-1 resize-none bg-transparent py-2.5 text-[15px] text-cream outline-none placeholder:text-faint"
          />
          {!text.trim() && !photo && !editing ? (
            <RecordButton onStart={() => void recorder.start()} disabled={recorder.state === 'starting'} />
          ) : (
            <button
              type="submit"
              disabled={editing ? !text.trim() && !editing.image_url : !text.trim() && !photo}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-ink shadow-glow transition hover:brightness-110 disabled:bg-none disabled:bg-surface disabled:text-faint disabled:shadow-none"
              aria-label={editing ? 'Save edit' : 'Send'}
            >
              {editing ? <Check className="size-5" /> : <SendHorizontal className="size-5" />}
            </button>
          )}
        </div>
      )}
    </form>
  )
}
