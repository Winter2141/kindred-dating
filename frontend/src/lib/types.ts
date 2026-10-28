export type Gender = 'woman' | 'man' | 'nonbinary'
export type SwipeAction = 'like' | 'pass' | 'super'

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
}

export interface Me extends PublicProfile {
  email: string
  birthdate: string
  interested_in: Gender[]
  age_min: number
  age_max: number
}

export interface Candidate extends PublicProfile {
  compatibility: number
  shared_interests: string[]
  super_liked_you: boolean
}

export interface Message {
  id: number
  match_id: number
  sender_id: number
  body: string
  created_at: string
  read_at: string | null
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
}

export interface SwipeResult {
  matched: boolean
  match: Match | null
}

export interface Like {
  user: PublicProfile
  action: SwipeAction
  created_at: string
}

export interface Meta {
  interests: { name: string; emoji: string }[]
  prompt_questions: string[]
  genders: Gender[]
  max_interests: number
  max_prompts: number
  max_photos: number
}

export interface Session {
  access_token: string
  token_type: 'bearer'
  user: Me
}

export type ServerEvent =
  | { type: 'hello'; user_id: number; online: number[] }
  | { type: 'message.new'; message: Message; client_id: string | null }
  | { type: 'typing'; match_id: number; user_id: number; is_typing: boolean }
  | { type: 'read'; match_id: number; reader_id: number; read_at: string }
  | { type: 'presence'; user_id: number; online: boolean; last_active_at: string }
  | { type: 'match.new'; match: Match }
  | { type: 'match.removed'; match_id: number }
  | { type: 'pong' }
  | { type: 'error'; detail: string; match_id?: number }

export type ClientEvent =
  | { type: 'message.send'; match_id: number; body: string; client_id: string }
  | { type: 'typing'; match_id: number; is_typing: boolean }
  | { type: 'read'; match_id: number }
  | { type: 'ping' }
