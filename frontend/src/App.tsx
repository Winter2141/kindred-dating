import { useQuery } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { ChatPage } from '@/pages/Chat'
import { DiscoverPage } from '@/pages/Discover'
import { LandingPage } from '@/pages/Landing'
import { LikesPage } from '@/pages/Likes'
import { LoginPage, SignupPage } from '@/pages/Auth'
import { MatchesLayout, NoChatSelected } from '@/pages/Matches'
import { ProfilePage } from '@/pages/Profile'
import { RealtimeProvider } from '@/realtime/RealtimeProvider'
import { useAuth } from '@/store/auth'

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token)
  const setUser = useAuth((s) => s.setUser)
  // Refresh the stored profile once per session; a 401 signs the user out inside api().
  const me = useQuery({ queryKey: keys.me, queryFn: api.me, enabled: Boolean(token) })
  useEffect(() => {
    if (me.data) setUser(me.data)
  }, [me.data, setUser])

  if (!token) return <Navigate to="/login" replace />
  return <RealtimeProvider>{children}</RealtimeProvider>
}

function GuestOnly({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token)
  return token ? <Navigate to="/app/discover" replace /> : children
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<GuestOnly><LandingPage /></GuestOnly>} />
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/signup" element={<GuestOnly><SignupPage /></GuestOnly>} />
      <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Navigate to="discover" replace />} />
        <Route path="discover" element={<DiscoverPage />} />
        <Route path="likes" element={<LikesPage />} />
        <Route path="matches" element={<MatchesLayout />}>
          <Route index element={<NoChatSelected />} />
          <Route path=":matchId" element={<ChatPage />} />
        </Route>
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
