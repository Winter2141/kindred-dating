import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import {
  applyEdit,
  applyEditToMatches,
  applyChatSettings,
  applyMessageToMatches,
  applyReaction,
  applyReadReceipt,
  applyUnsend,
  applyUnsendToMatches,
  keys,
  markPendingFailed,
  setPresence,
  upsertMessage,
} from '@/lib/cache'
import * as calls from '@/lib/calls'
import { upsertDate } from '@/lib/dates'
import { notifyDesktop } from '@/lib/desktop'
import { isQuietNow } from '@/lib/quiet'
import { refetchIfLoading } from '@/lib/freshness'
import { applyNotification, notificationHref, notificationText } from '@/lib/notifications'
import { previewText } from '@/lib/photos'
import { RealtimeClient, socketUrl } from '@/lib/realtime'
import type {
  ClientEvent,
  DateProposal,
  Match,
  Message,
  NotificationList,
  ServerEvent,
} from '@/lib/types'
import { useAuth } from '@/store/auth'
import { useLive, useToasts } from '@/store/live'
import { usePrefs } from '@/store/prefs'

const TYPING_TIMEOUT_MS = 6000

const RealtimeContext = createContext<RealtimeClient | null>(null)

/** Send an event over the shared socket (no-op while signed out). */
export function useRealtimeSend(): (event: ClientEvent) => void {
  const client = useContext(RealtimeContext)
  return useCallback((event: ClientEvent) => client?.send(event), [client])
}

/** Desktop alerts are switched on here and it isn't the person's quiet hours. */
function desktopAlertsOn(): boolean {
  return usePrefs.getState().desktopNotifications && !isQuietNow(useAuth.getState().user?.quiet_hours)
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token)
  const queryClient = useQueryClient()
  const location = useLocation()
  // Constructing the client is free of side effects; the effect below opens and closes it.
  const client = useMemo(
    () =>
      token
        ? new RealtimeClient(socketUrl(token), { onUnauthorized: () => useAuth.getState().signOut() })
        : null,
    [token],
  )

  const pathRef = useRef(location.pathname)
  useEffect(() => {
    pathRef.current = location.pathname
  }, [location.pathname])
  const typingTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  // Calls signal over this socket; hang up if it goes away (signing out, switching account).
  useEffect(() => {
    if (!client) return
    calls.bindCalls(
      (event) => client.send(event),
      (title, body) => useToasts.getState().push({ title, body }),
    )
    return () => {
      if (calls.inCall()) calls.hangUp('ended')
      calls.bindCalls(() => {}, () => {})
    }
  }, [client])

  useEffect(() => {
    if (!client) return
    let wasReconnecting = false
    const offStatus = client.onStatus((status) => {
      useLive.getState().setStatus(status)
      if (status === 'reconnecting') wasReconnecting = true
      if (status === 'open' && wasReconnecting) {
        // We may have missed events while offline; refetch what's on screen.
        wasReconnecting = false
        void queryClient.invalidateQueries({ queryKey: keys.matches })
        void queryClient.invalidateQueries({ queryKey: ['messages'] })
      }
    })
    client.start()
    return () => {
      offStatus()
      client.stop()
    }
  }, [client, queryClient])

  useEffect(() => {
    if (!client) return
    const timers = typingTimers.current

    const setTyping = (matchId: number, userId: number | undefined) => {
      clearTimeout(timers.get(matchId))
      useLive.getState().setTyping(matchId, userId)
      if (userId !== undefined) {
        timers.set(
          matchId,
          setTimeout(() => useLive.getState().setTyping(matchId, undefined), TYPING_TIMEOUT_MS),
        )
      }
    }

    const onMessage = (message: Message, clientId: string | null) => {
      const me = useAuth.getState().user
      const { activeMatchId } = useLive.getState()
      queryClient.setQueryData<Message[]>(keys.messages(message.match_id), (list) =>
        list ? upsertMessage(list, message, clientId) : list,
      )
      refetchIfLoading(queryClient, keys.messages(message.match_id))
      queryClient.setQueryData<Match[]>(keys.matches, (matches) =>
        applyMessageToMatches(matches, message, me?.id ?? -1, activeMatchId),
      )
      if (message.sender_id === me?.id) return
      setTyping(message.match_id, undefined)
      const match = queryClient
        .getQueryData<Match[]>(keys.matches)
        ?.find((m) => m.id === message.match_id)
      if (match?.muted) return
      if (match) {
        // Even the open chat is "unseen" while the tab is in the background.
        notifyDesktop(
          {
            title: match.user.name,
            body: previewText(message),
            icon: match.user.photos[0],
            href: `/app/matches/${match.id}`,
            tag: `match-${match.id}`,
          },
          { enabled: desktopAlertsOn() },
        )
      }
      if (activeMatchId === message.match_id) return
      if (!match) {
        void queryClient.invalidateQueries({ queryKey: keys.matches })
        return
      }
      useToasts.getState().push({
        title: match.user.name,
        body: previewText(message),
        image: match.user.photos[0],
        href: `/app/matches/${match.id}`,
      })
    }

    const handle = (event: ServerEvent) => {
      switch (event.type) {
        case 'hello':
          useLive.getState().resetOnline(event.online)
          break
        case 'message.new':
          onMessage(event.message, event.client_id)
          break
        case 'message.edited':
          queryClient.setQueryData<Message[]>(keys.messages(event.match_id), (list) => applyEdit(list, event.message))
          queryClient.setQueryData<Match[]>(keys.matches, (matches) => applyEditToMatches(matches, event.message))
          break
        case 'message.deleted':
          queryClient.setQueryData<Message[]>(keys.messages(event.match_id), (list) =>
            applyUnsend(list, event.message_id, event.deleted_at),
          )
          queryClient.setQueryData<Match[]>(keys.matches, (matches) =>
            applyUnsendToMatches(matches, event.message_id, event.deleted_at),
          )
          break
        case 'typing':
          setTyping(event.match_id, event.is_typing ? event.user_id : undefined)
          break
        case 'read':
          queryClient.setQueryData<Message[]>(keys.messages(event.match_id), (list) =>
            applyReadReceipt(list, event.reader_id, event.read_at),
          )
          break
        case 'reaction': {
          queryClient.setQueryData<Message[]>(keys.messages(event.match_id), (list) =>
            applyReaction(list, event.message_id, event.user_id, event.emoji),
          )
          const me = useAuth.getState().user
          const reactedToMine = queryClient
            .getQueryData<Message[]>(keys.messages(event.match_id))
            ?.find((m) => m.id === event.message_id)?.sender_id === me?.id
          const elsewhere = useLive.getState().activeMatchId !== event.match_id
          if (event.emoji && event.user_id !== me?.id && elsewhere && reactedToMine) {
            const match = queryClient
              .getQueryData<Match[]>(keys.matches)
              ?.find((m) => m.id === event.match_id)
            if (match) {
              useToasts.getState().push({
                title: match.user.name,
                body: `Reacted ${event.emoji} to your message`,
                image: match.user.photos[0],
                href: `/app/matches/${match.id}`,
              })
            }
          }
          break
        }
        case 'presence':
          useLive.getState().setOnline(event.user_id, event.online)
          queryClient.setQueryData<Match[]>(keys.matches, (matches) =>
            setPresence(matches, event.user_id, event.online, event.last_active_at),
          )
          break
        case 'match.new': {
          queryClient.setQueryData<Match[]>(keys.matches, (matches) =>
            matches && !matches.some((m) => m.id === event.match.id)
              ? [event.match, ...matches]
              : matches,
          )
          void queryClient.invalidateQueries({ queryKey: keys.likes })
          const swiping = /^\/app\/(discover|likes)/.test(pathRef.current)
          if (!swiping) {
            useToasts.getState().push({
              title: `It's a match with ${event.match.user.name}!`,
              body: 'Say hi while the spark is fresh.',
              image: event.match.user.photos[0],
              href: `/app/matches/${event.match.id}`,
            })
          }
          break
        }
        case 'notification.new':
          queryClient.setQueryData<NotificationList>(keys.notifications, (feed) =>
            applyNotification(feed, event.notification),
          )
          if (event.notification.kind === 'like' || event.notification.kind === 'super_like') {
            void queryClient.invalidateQueries({ queryKey: keys.likes })
          }
          if (event.notification.kind === 'date_reminder') {
            useToasts.getState().push({
              title: 'Date reminder',
              body: event.notification.body,
              image: event.notification.actor?.photos[0],
              href: notificationHref(event.notification),
            })
          }
          if (event.notification.kind === 'verified' || event.notification.kind === 'verification_rejected') {
            void queryClient.invalidateQueries({ queryKey: keys.verification })
            void queryClient.invalidateQueries({ queryKey: keys.me })
            useToasts.getState().push({ title: notificationText(event.notification) })
          }
          if (event.notification.kind !== 'message') {
            // Messages already raised their own desktop notification above.
            notifyDesktop(
              {
                title: notificationText(event.notification),
                icon: event.notification.actor?.photos[0],
                href: notificationHref(event.notification),
                tag: `notification-${event.notification.id}`,
              },
              { enabled: desktopAlertsOn() },
            )
          }
          break
        case 'date.updated': {
          const { date } = event
          queryClient.setQueryData<DateProposal[]>(keys.dates(date.match_id), (list) => upsertDate(list, date))
          void queryClient.invalidateQueries({ queryKey: keys.upcomingDates })
          const me = useAuth.getState().user
          const elsewhere = useLive.getState().activeMatchId !== date.match_id
          const match = queryClient.getQueryData<Match[]>(keys.matches)?.find((m) => m.id === date.match_id)
          const theirMove =
            (date.status === 'proposed' && date.proposer_id !== me?.id) ||
            (date.status === 'accepted' && date.proposer_id === me?.id)
          if (match && elsewhere && theirMove) {
            useToasts.getState().push({
              title: date.status === 'accepted' ? `${match.user.name} said yes!` : `${match.user.name} asked you out`,
              body: date.place,
              image: match.user.photos[0],
              href: `/app/matches/${match.id}`,
            })
          }
          break
        }
        case 'match.settings': {
          const { match_id: matchId, pinned, archived, muted, muted_until: mutedUntil } = event
          queryClient.setQueryData<Match[]>(keys.matches, (matches) =>
            applyChatSettings(matches, matchId, { pinned, archived, muted, muted_until: mutedUntil }),
          )
          break
        }
        case 'match.removed':
          queryClient.setQueryData<Match[]>(keys.matches, (matches) =>
            matches?.filter((m) => m.id !== event.match_id),
          )
          queryClient.removeQueries({ queryKey: keys.messages(event.match_id) })
          break
        case 'call.ringing':
          calls.onRinging(event.call_id, event.match_id)
          break
        case 'call.incoming':
          calls.onIncoming(event.call_id, event.match_id, event.kind, event.from)
          notifyDesktop(
            {
              title: `${event.from.name} is calling`,
              body: `Incoming ${event.kind} call`,
              icon: event.from.photo ?? undefined,
              href: `/app/matches/${event.match_id}`,
              tag: `call-${event.call_id}`,
            },
            { enabled: desktopAlertsOn() },
          )
          break
        case 'call.accepted':
          void calls.onAccepted(event.call_id)
          break
        case 'call.signal':
          void calls.onSignal(event.call_id, event.data)
          break
        case 'call.ended':
          calls.onEnded(event.call_id, event.reason, event.by, useAuth.getState().user?.id)
          break
        case 'call.failed':
          calls.onFailed(event.detail)
          break
        case 'error':
          // A message the server refused (e.g. sending too fast): fail it now instead of
          // leaving it "Sending…" until the timeout.
          if (event.client_id && event.match_id) {
            queryClient.setQueryData<Message[]>(keys.messages(event.match_id), (list) =>
              markPendingFailed(list, event.client_id!),
            )
            useToasts.getState().push({ title: "Message didn't send", body: event.detail })
          }
          break
        default:
          break
      }
    }

    const unsubscribe = client.subscribe(handle)
    return () => {
      unsubscribe()
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [client, queryClient])

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>
}
