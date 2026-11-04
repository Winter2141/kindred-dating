export type Gender = 'woman' | 'man' | 'nonbinary'
export type SwipeAction = 'like' | 'pass' | 'super'
export type ReportReason = 'fake_profile' | 'inappropriate' | 'harassment' | 'spam' | 'underage' | 'other'

export interface Prompt {
  question: string
  answer: string
}

export interface PublicProfile {
  id: number
  name: string
  age: number
  gender: Gender
  bio: string
  job_title: string
  city: string
  interests: string[]
  photos: string[]
  prompts: Prompt[]
  last_active_at: string
  is_online: boolean
  /** Rounded kilometres from you, when both of you have a location. */
  distance_km?: number | null
  /** A moderator matched a posed selfie to their photos. */
  verified?: boolean
}

export interface Pose {
  id: string
  emoji: string
  text: string
}

export interface VerificationState {
  status: 'none' | 'awaiting_photo' | 'pending' | 'approved' | 'rejected'
  verified: boolean
  pose: Pose | null
  note: string
}

export interface VerificationReview {
  id: number
  user: PublicProfile
  pose: Pose
  selfie_url: string | null
  status: 'pending' | 'approved' | 'rejected'
  note: string
  submitted_at: string | null
  reviewed_at: string | null
}

export interface Me extends PublicProfile {
  email: string
  birthdate: string
  interested_in: Gender[]
  age_min: number
  age_max: number
  max_distance_km: number
  has_location: boolean
  is_paused: boolean
  is_admin: boolean
  /** They followed the link in the confirmation email. */
  email_verified?: boolean
  two_factor_enabled?: boolean
}

export interface MfaChallenge {
  mfa_required: true
  mfa_token: string
}

export interface TwoFactorStatus {
  enabled: boolean
  recovery_codes_left: number
}

export interface TwoFactorSetup {
  secret: string
  otpauth_url: string
  qr_svg: string
}

export interface OutboxEmail {
  id: number
  to: string
  subject: string
  body: string
  kind: string
  created_at: string
}

export interface Candidate extends PublicProfile {
  compatibility: number
  shared_interests: string[]
  super_liked_you: boolean
  /** 0-100 agreement on compatibility questions, once you share enough answers. */
  agreement?: number | null
}

export interface Question {
  id: string
  text: string
  options: string[]
  topic: string
}

export interface QuestionCatalog {
  questions: Question[]
  importance_labels: string[]
  min_common: number
  answers: Record<string, { answer: number; acceptable: number[]; importance: number }>
}

export interface Agreement {
  percent: number | null
  common: number
  same: { question: string; answer: string }[]
}

export interface Reaction {
  user_id: number
  emoji: string
}

export interface TopPick extends Candidate {
  reason: string
}

export interface TopPicks {
  picks: TopPick[]
  refreshes_at: string
}

export type DateStatus = 'proposed' | 'accepted' | 'declined' | 'cancelled'

export interface DateProposal {
  id: number
  match_id: number
  proposer_id: number
  place: string
  starts_at: string
  note: string
  status: DateStatus
  created_at: string
  responded_at: string | null
}

export interface UpcomingDate extends DateProposal {
  with_user: PublicProfile
}

/** The message a reply answers, as quoted above the reply. */
export interface QuotedMessage {
  id: number
  sender_id: number
  body: string
  image_url: string | null
  audio_url?: string | null
  deleted_at: string | null
}

export interface Message {
  id: number
  match_id: number
  sender_id: number
  body: string
  image_url?: string | null
  /** Voice notes: the recording, its length and 48 bars of 0-100 to draw. */
  audio_url?: string | null
  audio_ms?: number | null
  waveform?: number[] | null
  /** Call log entries: the kind of call, and its length (null if nobody answered). */
  call_kind?: 'audio' | 'video' | null
  call_ms?: number | null
  reply_to?: QuotedMessage | null
  created_at: string
  read_at: string | null
  deleted_at?: string | null
  edited_at?: string | null
  reactions?: Reaction[]
  /** Set on optimistic messages that the server hasn't confirmed yet. */
  pending?: string
  failed?: boolean
}

export interface Match {
  id: number
  user: PublicProfile
  created_at: string
  last_activity_at: string
  last_message: Message | null
  unread_count: number
  /** How I've filed this chat; nobody else sees these. */
  pinned?: boolean
  archived?: boolean
  muted?: boolean
  muted_until?: string | null
}

export interface ChatSettings {
  pinned: boolean
  archived: boolean
  muted: boolean
  muted_until: string | null
}

export interface SearchHit {
  match_id: number
  with_user: PublicProfile
  message: Message
}

export interface SearchResults {
  query: string
  people: Match[]
  messages: SearchHit[]
}

export interface SwipeResult {
  matched: boolean
  match: Match | null
}

export interface LikedItem {
  kind: 'photo' | 'prompt'
  photo: string | null
  question: string | null
  answer: string | null
}

export interface Like {
  user: PublicProfile
  action: SwipeAction
  created_at: string
  comment?: string | null
  liked_item?: LikedItem | null
}

export type ReportStatus = 'open' | 'dismissed' | 'actioned'

export interface AdminReport {
  id: number
  reason: ReportReason
  details: string
  status: ReportStatus
  created_at: string
  resolved_at: string | null
  reporter: PublicProfile
  reported: PublicProfile & { email: string; banned: boolean; open_reports: number }
}

export type MemberFilter = 'all' | 'banned' | 'verified' | 'unverified' | 'admins'

export interface AdminUser extends PublicProfile {
  email: string
  created_at: string
  banned: boolean
  email_verified: boolean
  is_admin: boolean
  is_persona: boolean
  open_reports: number
  matches: number
}

export interface AuditEvent {
  id: number
  action: string
  actor_name: string | null
  target: PublicProfile | null
  detail: string
  created_at: string
}

export interface ModerationStats {
  pending_verifications: number
  open_reports: number
  resolved_this_week: number
  banned_users: number
  total_users: number
}

export interface ProfileStrength {
  score: number
  tips: { key: string; text: string; points: number }[]
}

export interface ActivityDay {
  day: string
  likes_received: number
  matches: number
  messages: number
}

export interface Insights {
  days: number
  likes_sent: number
  passes_sent: number
  likes_received: number
  super_likes_received: number
  matches: number
  match_rate: number
  messages_sent: number
  messages_received: number
  reply_rate: number | null
  median_reply_minutes: number | null
  liked_by_interests: { interest: string; count: number }[]
  activity: ActivityDay[]
}

export interface Meta {
  interests: { name: string; emoji: string }[]
  prompt_questions: string[]
  genders: Gender[]
  max_interests: number
  max_prompts: number
  max_photos: number
  reactions: string[]
}

export interface Session {
  access_token: string
  token_type: 'bearer'
  user: Me
  session_id?: number | null
}

export type EmailCategory = 'matches' | 'messages' | 'likes' | 'dates'

/** Which notifications also come by email, in one digest (GET /api/me/email-preferences). */
export type EmailPrefs = Record<EmailCategory, boolean> & { email_verified: boolean }

/** A browser that's signed in to the account (GET /api/me/sessions). */
export interface DeviceSession {
  id: number
  label: string
  mobile: boolean
  ip_address: string
  created_at: string
  last_seen_at: string
  current: boolean
}

export type NotificationKind =
  | 'like'
  | 'super_like'
  | 'match'
  | 'message'
  | 'date_reminder'
  | 'verified'
  | 'verification_rejected'

/** Named AppNotification so it doesn't clash with the browser's Notification. */
export interface AppNotification {
  id: number
  kind: NotificationKind
  actor: PublicProfile | null
  match_id: number | null
  body: string
  count: number
  created_at: string
  read_at: string | null
}

export interface NotificationList {
  items: AppNotification[]
  unread: number
}

export type ServerEvent =
  | { type: 'hello'; user_id: number; online: number[] }
  | { type: 'message.new'; message: Message; client_id: string | null }
  | { type: 'message.edited'; match_id: number; message: Message }
  | { type: 'message.deleted'; match_id: number; message_id: number; deleted_at: string }
  | { type: 'typing'; match_id: number; user_id: number; is_typing: boolean }
  | { type: 'read'; match_id: number; reader_id: number; read_at: string }
  | { type: 'reaction'; match_id: number; message_id: number; user_id: number; emoji: string | null }
  | { type: 'presence'; user_id: number; online: boolean; last_active_at: string }
  | { type: 'match.new'; match: Match }
  | { type: 'match.removed'; match_id: number }
  | ({ type: 'match.settings'; match_id: number } & ChatSettings)
  | { type: 'notification.new'; notification: AppNotification }
  | { type: 'date.updated'; date: DateProposal }
  | { type: 'call.ringing'; call_id: string; match_id: number }
  | {
      type: 'call.incoming'
      call_id: string
      match_id: number
      kind: 'audio' | 'video'
      from: { id: number; name: string; photo: string | null }
    }
  | { type: 'call.accepted'; call_id: string }
  | { type: 'call.signal'; call_id: string; data: Record<string, unknown> }
  | { type: 'call.ended'; call_id: string; reason: string; by: number | null }
  | { type: 'call.failed'; reason: string; detail: string; match_id: number | null; call_id: string | null }
  | { type: 'pong' }
  | { type: 'error'; detail: string; match_id?: number; client_id?: string | null }

export type ClientEvent =
  | { type: 'message.send'; match_id: number; body: string; client_id: string; reply_to_id?: number | null }
  | { type: 'typing'; match_id: number; is_typing: boolean }
  | { type: 'read'; match_id: number }
  | { type: 'react'; match_id: number; message_id: number; emoji: string | null }
  | { type: 'call.invite'; match_id: number; kind: 'audio' | 'video' }
  | { type: 'call.accept'; call_id: string }
  | { type: 'call.signal'; call_id: string; data: Record<string, unknown> }
  | { type: 'call.end'; call_id: string; reason: 'ended' | 'declined' | 'cancelled' }
  | { type: 'ping' }
