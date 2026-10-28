import { useAuth } from '@/store/auth'
import type {
  Candidate,
  Like,
  Match,
  Me,
  Message,
  Meta,
  Prompt,
  PublicProfile,
  Session,
  SwipeAction,
  SwipeResult,
} from './types'

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
  return (response.status === 204 ? undefined : await response.json()) as T
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
  >
>

export const api = {
  meta: () => request<Meta>('/api/meta'),
  login: (email: string, password: string) =>
    request<Session>('/api/auth/login', { method: 'POST', body: { email, password } }),
  register: (data: RegisterInput) =>
    request<Session>('/api/auth/register', { method: 'POST', body: { ...data } }),

  me: () => request<Me>('/api/me'),
  updateMe: (data: ProfileUpdate) => request<Me>('/api/me', { method: 'PATCH', body: data }),
  uploadPhoto: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<Me>('/api/me/photos', { method: 'POST', body: form })
  },
  deletePhoto: (url: string) =>
    request<Me>(`/api/me/photos?url=${encodeURIComponent(url)}`, { method: 'DELETE' }),
  user: (id: number) => request<PublicProfile>(`/api/users/${id}`),

  discover: () => request<Candidate[]>('/api/discover'),
  swipe: (targetId: number, action: SwipeAction) =>
    request<SwipeResult>('/api/swipes', { method: 'POST', body: { target_id: targetId, action } }),
  undoSwipe: () => request<PublicProfile>('/api/swipes/undo', { method: 'POST' }),
  likes: () => request<Like[]>('/api/likes'),

  matches: () => request<Match[]>('/api/matches'),
  match: (id: number) => request<Match>(`/api/matches/${id}`),
  unmatch: (id: number) => request<void>(`/api/matches/${id}`, { method: 'DELETE' }),
  messages: (id: number, before?: number) =>
    request<Message[]>(`/api/matches/${id}/messages${before ? `?before=${before}` : ''}`),
  icebreakers: (id: number) => request<string[]>(`/api/matches/${id}/icebreakers`),
}
