import { useQuery } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { ChatPage } from '@/pages/Chat'
import { DiscoverPage } from '@/pages/Discover'
import { InsightsPage } from '@/pages/Insights'
import { LandingPage } from '@/pages/Landing'
import { LikesPage } from '@/pages/Likes'
import {
  DevOutboxPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  UnsubscribePage,
  VerifyEmailPage,
} from '@/pages/AccountRecovery'
import { LoginPage, SignupPage } from '@/pages/Auth'
import { MatchesLayout, NoChatSelected } from '@/pages/Matches'
import { ModerationPage } from '@/pages/Moderation'
import { ProfilePage } from '@/pages/Profile'
import { SettingsPage } from '@/pages/Settings'
import { RealtimeProvider } from '@/realtime/RealtimeProvider'
import { watchTheme } from '@/lib/theme'
import { useAuth } from '@/store/auth'
import { usePrefs } from '@/store/prefs'

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
  const theme = usePrefs((s) => s.theme)
  useEffect(() => watchTheme(theme), [theme])
  return (
    <Routes>
      <Route path="/" element={<GuestOnly><LandingPage /></GuestOnly>} />
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/signup" element={<GuestOnly><SignupPage /></GuestOnly>} />
      <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
      {/* Reset and confirm links work whether or not you're signed in on this device. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/unsubscribe" element={<UnsubscribePage />} />
      <Route path="/dev/outbox" element={<DevOutboxPage />} />
      <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Navigate to="discover" replace />} />
        <Route path="discover" element={<DiscoverPage />} />
        <Route path="likes" element={<LikesPage />} />
        <Route path="matches" element={<MatchesLayout />}>
          <Route index element={<NoChatSelected />} />
          <Route path=":matchId" element={<ChatPage />} />
        </Route>
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="moderation" element={<ModerationPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
