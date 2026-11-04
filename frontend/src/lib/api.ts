import { useAuth } from '@/store/auth'
import { NO_FILTERS, filtersToQuery, type DiscoverFilters } from './filters'
import type { QuestionAnswer } from './questions'
import type {
  AdminReport,
  AdminUser,
  Agreement,
  AuditEvent,
  MemberFilter,
  AppNotification,
  ChatSettings,
  DateProposal,
  DeviceSession,
  EmailCategory,
  EmailPrefs,
  Insights,
  Candidate,
  Like,
  Match,
  Me,
  Message,
  Meta,
  MfaChallenge,
  ModerationStats,
  NotificationList,
  OutboxEmail,
  ProfileStrength,
  Prompt,
  QuestionCatalog,
  PublicProfile,
  ReportReason,
  ReportStatus,
  SearchResults,
  Session,
  SwipeAction,
  SwipeResult,
  TopPicks,
  Trends,
  TwoFactorSetup,
  TwoFactorStatus,
  UpcomingDate,
  VerificationReview,
  VerificationState,
} from './types'

export function isMfaChallenge(result: Session | MfaChallenge): result is MfaChallenge {
  return 'mfa_required' in result
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** FastAPI errors are either a string or a list of validation errors. */
export function describeError(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string; loc?: (string | number)[] }
    const field = first.loc?.filter((part) => part !== 'body').join(' ')
    const message = (first.msg ?? 'Invalid value').replace(/^Value error, /, '')
    return field ? `${field.replace(/_/g, ' ')}: ${message}` : message
  }
  return 'Something went wrong'
}

type Body = Record<string, unknown> | FormData

async function request<T>(path: string, init: { method?: string; body?: Body } = {}): Promise<T> {
  const { token, signOut } = useAuth.getState()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (init.body instanceof FormData) {
    body = init.body
  } else if (init.body) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.body)
  }

  const response = await fetch(path, { method: init.method ?? 'GET', headers, body })
  if (response.status === 401 && token) signOut()
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new ApiError(response.status, describeError(payload.detail))
  }
  // Some endpoints answer with no body at all (204, and 202 for forgot-password).
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export interface RegisterInput {
  email: string
  password: string
  name: string
  birthdate: string
  gender: string
  interested_in: string[]
  age_min: number
  age_max: number
  bio: string
  job_title: string
  city: string
  interests: string[]
  prompts: Prompt[]
}

export type ProfileUpdate = Partial<
  Pick<
    Me,
    | 'name'
    | 'bio'
    | 'job_title'
    | 'city'
    | 'interests'
    | 'prompts'
    | 'interested_in'
    | 'age_min'
    | 'age_max'
    | 'photos'
    | 'is_paused'
    | 'max_distance_km'
  >
> & { latitude?: number; longitude?: number }

export interface ChatSettingsChange {
  pinned?: boolean
  archived?: boolean
  mute?: '1h' | '8h' | '1w' | 'always' | 'off'
}

export const api = {
  meta: () => request<Meta>('/api/meta'),
  /** A session, or a challenge to finish with loginWithCode when two-factor is on. */
  login: (email: string, password: string) =>
    request<Session | MfaChallenge>('/api/auth/login', { method: 'POST', body: { email, password } }),
  loginWithCode: (mfaToken: string, code: string) =>
    request<Session>('/api/auth/login/2fa', { method: 'POST', body: { mfa_token: mfaToken, code } }),
  twoFactorStatus: () => request<TwoFactorStatus>('/api/me/2fa'),
  startTwoFactor: () => request<TwoFactorSetup>('/api/me/2fa/setup', { method: 'POST' }),
  enableTwoFactor: (code: string) =>
    request<{ recovery_codes: string[] }>('/api/me/2fa/enable', { method: 'POST', body: { code } }),
  disableTwoFactor: (password: string, code: string) =>
    request<void>('/api/me/2fa/disable', { method: 'POST', body: { password, code } }),
  regenerateRecoveryCodes: (password: string) =>
    request<{ recovery_codes: string[] }>('/api/me/2fa/recovery-codes', { method: 'POST', body: { password } }),
  register: (data: RegisterInput) =>
    request<Session>('/api/auth/register', { method: 'POST', body: { ...data } }),
  forgotPassword: (email: string) => request<void>('/api/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token: string, newPassword: string) =>
    request<Session>('/api/auth/reset-password', { method: 'POST', body: { token, new_password: newPassword } }),
  verifyEmail: (token: string) =>
    request<{ email: string; verified: true }>('/api/auth/verify-email', { method: 'POST', body: { token } }),
  resendVerification: () => request<void>('/api/me/verify-email/resend', { method: 'POST' }),
  outbox: () => request<OutboxEmail[]>('/api/dev/outbox'),

  me: () => request<Me>('/api/me'),
  strength: () => request<ProfileStrength>('/api/me/strength'),
  insights: (days: number) => request<Insights>(`/api/me/insights?days=${days}`),
  updateMe: (data: ProfileUpdate) => request<Me>('/api/me', { method: 'PATCH', body: data }),
  uploadPhoto: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<Me>('/api/me/photos', { method: 'POST', body: form })
  },
  deletePhoto: (url: string) =>
    request<Me>(`/api/me/photos?url=${encodeURIComponent(url)}`, { method: 'DELETE' }),
  user: (id: number) => request<PublicProfile>(`/api/users/${id}`),
  questions: () => request<QuestionCatalog>('/api/questions'),
  answerQuestion: (id: string, answer: QuestionAnswer) =>
    request<QuestionAnswer>(`/api/questions/${id}`, { method: 'PUT', body: { ...answer } }),
  skipQuestion: (id: string) => request<void>(`/api/questions/${id}`, { method: 'DELETE' }),
  agreement: (userId: number) => request<Agreement>(`/api/users/${userId}/agreement`),
  places: (query: string) => request<string[]>(`/api/places?q=${encodeURIComponent(query)}`),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<Session>('/api/me/password', {
      method: 'POST',
      body: { current_password: currentPassword, new_password: newPassword },
    }),
  startTrip: (place: string, until: string) => request<Me>('/api/me/travel', { method: 'PUT', body: { place, until } }),
  endTrip: () => request<Me>('/api/me/travel', { method: 'DELETE' }),
  changeEmail: (newEmail: string, password: string) =>
    request<Me>('/api/me/email', { method: 'POST', body: { new_email: newEmail, password } }),
  resendEmailChange: () => request<void>('/api/me/email/resend', { method: 'POST' }),
  cancelEmailChange: () => request<Me>('/api/me/email/pending', { method: 'DELETE' }),
  confirmEmailChange: (token: string) =>
    request<{ email: string; verified: true }>('/api/auth/confirm-email-change', { method: 'POST', body: { token } }),
  signOutEverywhere: () => request<void>('/api/me/sign-out-everywhere', { method: 'POST' }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  emailPrefs: () => request<EmailPrefs>('/api/me/email-preferences'),
  setEmailPrefs: (prefs: Record<EmailCategory, boolean>) =>
    request<EmailPrefs>('/api/me/email-preferences', { method: 'PUT', body: prefs }),
  unsubscribe: (token: string) => request<void>('/api/email/unsubscribe', { method: 'POST', body: { token } }),
  deviceSessions: () => request<DeviceSession[]>('/api/me/sessions'),
  endSession: (id: number) => request<void>(`/api/me/sessions/${id}`, { method: 'DELETE' }),
  signOutOtherSessions: () => request<void>('/api/me/sessions/sign-out-others', { method: 'POST' }),
  /** The JSON export as a file to save. */
  exportData: async (): Promise<Blob> => {
    const { token } = useAuth.getState()
    const response = await fetch('/api/me/export', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new ApiError(response.status, describeError(payload.detail))
    }
    return response.blob()
  },
  deleteAccount: (password: string) =>
    request<void>('/api/me', { method: 'DELETE', body: { password } }),

  discover: (filters: DiscoverFilters = NO_FILTERS) => request<Candidate[]>(`/api/discover${filtersToQuery(filters)}`),
  topPicks: () => request<TopPicks>('/api/discover/top-picks'),
  swipe: (targetId: number, action: SwipeAction, extras: { liked_item?: string; comment?: string } = {}) =>
    request<SwipeResult>('/api/swipes', { method: 'POST', body: { target_id: targetId, action, ...extras } }),
  undoSwipe: () => request<PublicProfile>('/api/swipes/undo', { method: 'POST' }),
  likes: () => request<Like[]>('/api/likes'),

  matches: () => request<Match[]>('/api/matches'),
  search: (query: string) => request<SearchResults>(`/api/search?q=${encodeURIComponent(query)}`),
  match: (id: number) => request<Match>(`/api/matches/${id}`),
  unmatch: (id: number) => request<void>(`/api/matches/${id}`, { method: 'DELETE' }),
  chatSettings: (id: number, changes: ChatSettingsChange) =>
    request<ChatSettings & { match_id: number }>(`/api/matches/${id}/settings`, {
      method: 'PATCH',
      body: { ...changes },
    }),
  messages: (id: number, before?: number) =>
    request<Message[]>(`/api/matches/${id}/messages${before ? `?before=${before}` : ''}`),
  icebreakers: (id: number) => request<string[]>(`/api/matches/${id}/icebreakers`),
  callConfig: (id: number) => request<{ ice_servers: RTCIceServer[] }>(`/api/matches/${id}/call-config`),
  sendPhoto: (matchId: number, file: File, caption: string, replyToId?: number | null) => {
    const form = new FormData()
    form.append('file', file)
    form.append('caption', caption)
    if (replyToId) form.append('reply_to_id', String(replyToId))
    return request<Message>(`/api/matches/${matchId}/photos`, { method: 'POST', body: form })
  },
  sendVoice: (matchId: number, recording: Blob, durationMs: number, waveform: number[], replyToId?: number | null) => {
    const form = new FormData()
    const extension = recording.type.includes('mp4') ? 'm4a' : recording.type.includes('ogg') ? 'ogg' : 'webm'
    form.append('file', recording, `voice-note.${extension}`)
    form.append('duration_ms', String(Math.round(durationMs)))
    form.append('waveform', JSON.stringify(waveform))
    if (replyToId) form.append('reply_to_id', String(replyToId))
    return request<Message>(`/api/matches/${matchId}/voice`, { method: 'POST', body: form })
  },
  editMessage: (matchId: number, messageId: number, body: string) =>
    request<Message>(`/api/matches/${matchId}/messages/${messageId}`, { method: 'PATCH', body: { body } }),
  unsend: (matchId: number, messageId: number) =>
    request<Message>(`/api/matches/${matchId}/messages/${messageId}`, { method: 'DELETE' }),

  dates: (matchId: number) => request<DateProposal[]>(`/api/matches/${matchId}/dates`),
  dateIdeas: (matchId: number) => request<string[]>(`/api/matches/${matchId}/date-ideas`),
  proposeDate: (matchId: number, data: { place: string; starts_at: string; note: string }) =>
    request<DateProposal>(`/api/matches/${matchId}/dates`, { method: 'POST', body: data }),
  respondToDate: (matchId: number, dateId: number, response: 'accept' | 'decline') =>
    request<DateProposal>(`/api/matches/${matchId}/dates/${dateId}/respond`, {
      method: 'POST',
      body: { response },
    }),
  cancelDate: (matchId: number, dateId: number) =>
    request<DateProposal>(`/api/matches/${matchId}/dates/${dateId}/cancel`, { method: 'POST' }),
  upcomingDates: () => request<UpcomingDate[]>('/api/dates/upcoming'),

  notifications: () => request<NotificationList>('/api/notifications'),
  readNotification: (id: number) =>
    request<AppNotification>(`/api/notifications/${id}/read`, { method: 'POST' }),
  readAllNotifications: () => request<void>('/api/notifications/read', { method: 'POST' }),

  block: (userId: number) => request<void>('/api/blocks', { method: 'POST', body: { user_id: userId } }),
  unblock: (userId: number) => request<void>(`/api/blocks/${userId}`, { method: 'DELETE' }),
  blocks: () => request<PublicProfile[]>('/api/blocks'),
  report: (data: { user_id: number; reason: ReportReason; details: string; block: boolean }) =>
    request<{ id: number }>('/api/reports', { method: 'POST', body: data }),

  reports: (status: ReportStatus) => request<AdminReport[]>(`/api/admin/reports?status=${status}`),
  resolveReport: (id: number, action: 'dismiss' | 'ban') =>
    request<AdminReport>(`/api/admin/reports/${id}/resolve`, { method: 'POST', body: { action } }),
  unban: (userId: number) => request<void>(`/api/admin/users/${userId}/unban`, { method: 'POST' }),
  moderationStats: () => request<ModerationStats>('/api/admin/stats'),
  moderationTrends: (days: number) => request<Trends>(`/api/admin/trends?days=${days}`),
  members: ({ q, filter, limit, offset }: { q: string; filter: MemberFilter; limit: number; offset: number }) =>
    request<{ total: number; items: AdminUser[] }>(
      `/api/admin/users?${new URLSearchParams({ q, filter, limit: String(limit), offset: String(offset) })}`,
    ),
  banMember: (userId: number, reason: string) =>
    request<void>(`/api/admin/users/${userId}/ban`, { method: 'POST', body: { reason } }),
  audit: (before?: number) => request<AuditEvent[]>(`/api/admin/audit${before ? `?before=${before}` : ''}`),
  verificationQueue: () => request<VerificationReview[]>('/api/admin/verifications'),
  reviewVerification: (id: number, approve: boolean, note: string) =>
    request<VerificationReview>(`/api/admin/verifications/${id}/review`, { method: 'POST', body: { approve, note } }),

  verification: () => request<VerificationState>('/api/me/verification'),
  startVerification: () => request<VerificationState>('/api/me/verification', { method: 'POST' }),
  sendSelfie: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<VerificationState>('/api/me/verification/selfie', { method: 'POST', body: form })
  },
}

/** End this browser's session on the server as well, then forget the token here. */
export async function signOutHere(forget: () => void): Promise<void> {
  try {
    await api.logout()
  } catch {
    // Already signed out, or offline: forgetting the token is still the right thing to do.
  }
  forget()
}
