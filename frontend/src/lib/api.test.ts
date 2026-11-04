import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/store/auth'
import type { Me } from './types'
import { api, ApiError, signOutHere } from './api'

afterEach(() => vi.unstubAllGlobals())

function respond(status: number, body: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body || null, { status })))
}

describe('request', () => {
  it('accepts answers with no body, like 202 from forgot-password', async () => {
    respond(202, '')
    await expect(api.forgotPassword('maya@kindred.app')).resolves.toBeUndefined()
  })

  it('parses JSON bodies', async () => {
    respond(200, JSON.stringify({ email: 'maya@kindred.app', verified: true }))
    await expect(api.verifyEmail('token')).resolves.toEqual({ email: 'maya@kindred.app', verified: true })
  })

  it('turns error details into an ApiError', async () => {
    respond(400, JSON.stringify({ detail: 'That link is invalid or has expired' }))
    const error = await api.verifyEmail('old').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).message).toBe('That link is invalid or has expired')
  })
})

describe('signOutHere', () => {
  it('ends the session on the server, then forgets the token', async () => {
    respond(204, '')
    useAuth.setState({ token: 'token', user: { id: 1 } as Me })
    const forget = vi.fn()
    await signOutHere(forget)
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
    expect(forget).toHaveBeenCalledOnce()
  })

  it('still forgets the token when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const forget = vi.fn()
    await signOutHere(forget)
    expect(forget).toHaveBeenCalledOnce()
  })
})
