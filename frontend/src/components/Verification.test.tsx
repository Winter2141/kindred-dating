import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { notificationHref, notificationText } from '@/lib/notifications'
import type { AppNotification, VerificationState } from '@/lib/types'
import { VerificationFlow, VerificationQueue } from './Verification'

afterEach(() => vi.restoreAllMocks())

const wrap = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)

const state = (overrides: Partial<VerificationState> = {}): VerificationState => ({
  status: 'none',
  verified: false,
  pose: null,
  note: '',
  ...overrides,
})

describe('VerificationFlow', () => {
  it('starts with a pose and sends the selfie', async () => {
    vi.spyOn(api, 'verification').mockResolvedValue(state())
    vi.spyOn(api, 'startVerification').mockResolvedValue(
      state({ status: 'awaiting_photo', pose: { id: 'peace', emoji: '✌️', text: 'Hold up a peace sign' } }),
    )
    const send = vi.spyOn(api, 'sendSelfie').mockResolvedValue(state({ status: 'pending' }))
    const user = userEvent.setup()
    render(wrap(<VerificationFlow hasPhotos />))

    await user.click(await screen.findByRole('button', { name: /verify my photos/i }))
    expect(await screen.findByText('Hold up a peace sign')).toBeInTheDocument()

    const selfie = new File(['x'], 'me.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Selfie'), selfie)
    expect(send).toHaveBeenCalledWith(selfie)
    expect(await screen.findByText(/with our moderators/i)).toBeInTheDocument()
  })

  it('explains a rejection and needs a photo to start', async () => {
    vi.spyOn(api, 'verification').mockResolvedValue(state({ status: 'rejected', note: 'Pose not visible' }))
    render(wrap(<VerificationFlow hasPhotos={false} />))
    expect(await screen.findByText(/Pose not visible/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeDisabled()
    expect(screen.getByText('Add a profile photo first.')).toBeInTheDocument()
  })
})

describe('VerificationQueue', () => {
  it('approves or turns down with a reason', async () => {
    vi.spyOn(api, 'verificationQueue').mockResolvedValue([
      {
        id: 3,
        user: { id: 9, name: 'Priya', age: 29, photos: ['/p.jpg'] } as never,
        pose: { id: 'wave', emoji: '👋', text: 'Wave at the camera' },
        selfie_url: '/media/selfie.webp',
        status: 'pending',
        note: '',
        submitted_at: new Date().toISOString(),
        reviewed_at: null,
      },
    ])
    const review = vi.spyOn(api, 'reviewVerification').mockResolvedValue({} as never)
    const user = userEvent.setup()
    render(wrap(<VerificationQueue />))

    expect(await screen.findByText(/Wave at the camera/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /doesn't match/i }))
    const submit = screen.getByRole('button', { name: /turn down/i })
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText(/reason/i), 'Different person')
    await user.click(submit)
    expect(review).toHaveBeenCalledWith(3, false, 'Different person')
  })
})

describe('verification notifications', () => {
  const n = (kind: AppNotification['kind'], body = ''): AppNotification => ({
    id: 1,
    kind,
    actor: null,
    match_id: null,
    body,
    count: 1,
    created_at: '2026-11-03T10:00:00Z',
    read_at: null,
  })
  it('reads well and opens Settings', () => {
    expect(notificationText(n('verified'))).toBe('Your photos are verified ✓')
    expect(notificationText(n('verification_rejected', 'Pose not visible'))).toContain('Pose not visible')
    expect(notificationHref(n('verified'))).toBe('/app/settings')
  })
})
