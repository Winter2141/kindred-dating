import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import {
  applyMessageToMatches,
  applyReadReceipt,
  keys,
  setPresence,
  upsertMessage,
} from '@/lib/cache'
import { RealtimeClient, socketUrl } from '@/lib/realtime'
import type { ClientEvent, Match, Message, ServerEvent } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { useLive, useToasts } from '@/store/live'

const TYPING_TIMEOUT_MS = 6000

const RealtimeContext = createContext<RealtimeClient | null>(null)

/** Send an event over the shared socket (no-op while signed out). */
export function useRealtimeSend(): (event: ClientEvent) => void {
  const client = useContext(RealtimeContext)
  return useCallback((event: ClientEvent) => client?.send(event), [client])
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token)
  const queryClient = useQueryClient()
  const location = useLocation()
  const [client, setClient] = useState<RealtimeClient | null>(null)

  const pathRef = useRef(location.pathname)
  useEffect(() => {
    pathRef.current = location.pathname
  }, [location.pathname])
  const typingTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    if (!token) return
    const realtime = new RealtimeClient(socketUrl(token), {
      onUnauthorized: () => useAuth.getState().signOut(),
    })
    let wasReconnecting = false
    const offStatus = realtime.onStatus((status) => {
      useLive.getState().setStatus(status)
      if (status === 'reconnecting') wasReconnecting = true
      if (status === 'open' && wasReconnecting) {
        // We may have missed events while offline; refetch what's on screen.
        wasReconnecting = false
        void queryClient.invalidateQueries({ queryKey: keys.matches })
        void queryClient.invalidateQueries({ queryKey: ['messages'] })
      }
    })
    realtime.start()
    setClient(realtime)
    return () => {
      offStatus()
      realtime.stop()
      setClient(null)
    }
  }, [token, queryClient])

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
      queryClient.setQueryData<Match[]>(keys.matches, (matches) =>
        applyMessageToMatches(matches, message, me?.id ?? -1, activeMatchId),
      )
      if (message.sender_id === me?.id) return
      setTyping(message.match_id, undefined)
      if (activeMatchId === message.match_id) return
      const match = queryClient
        .getQueryData<Match[]>(keys.matches)
        ?.find((m) => m.id === message.match_id)
      if (!match) {
        void queryClient.invalidateQueries({ queryKey: keys.matches })
        return
      }
      useToasts.getState().push({
        title: match.user.name,
        body: message.body,
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
        case 'typing':
          setTyping(event.match_id, event.is_typing ? event.user_id : undefined)
          break
        case 'read':
          queryClient.setQueryData<Message[]>(keys.messages(event.match_id), (list) =>
            applyReadReceipt(list, event.reader_id, event.read_at),
          )
          break
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
        case 'match.removed':
          queryClient.setQueryData<Match[]>(keys.matches, (matches) =>
            matches?.filter((m) => m.id !== event.match_id),
          )
          queryClient.removeQueries({ queryKey: keys.messages(event.match_id) })
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
