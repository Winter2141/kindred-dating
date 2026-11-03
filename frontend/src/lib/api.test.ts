import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

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
