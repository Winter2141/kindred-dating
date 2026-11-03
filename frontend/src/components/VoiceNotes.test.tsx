import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RecordingBar, VoicePlayer, meterHeight } from './VoiceNotes'

describe('VoicePlayer', () => {
  it('shows the length and plays on click', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    render(<VoicePlayer src="/media/voice-1.webm" durationMs={4200} waveform={[10, 50, 90]} mine={false} />)
    expect(screen.getByText('0:04')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Play voice note' }))
    expect(play).toHaveBeenCalled()
  })

  it('seeks with the arrow keys', () => {
    render(<VoicePlayer src="/media/voice-1.webm" durationMs={20_000} waveform={null} mine />)
    const slider = screen.getByRole('slider', { name: 'Voice note position' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider).toHaveAttribute('aria-valuenow', '5')
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(slider).toHaveAttribute('aria-valuenow', '0')
  })
})

describe('RecordingBar', () => {
  it('shows the time and can be discarded or sent', async () => {
    const onCancel = vi.fn()
    const onSend = vi.fn()
    render(<RecordingBar elapsedMs={12_400} levels={[0.1, 0.2]} onCancel={onCancel} onSend={onSend} />)
    expect(screen.getByText('0:12')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Discard recording' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send voice note' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onSend).toHaveBeenCalled()
  })
})

describe('meterHeight', () => {
  it('keeps quiet speech visible without pinning loud speech to the top', () => {
    expect(meterHeight(0)).toBe(10)
    expect(meterHeight(0.05)).toBeGreaterThan(30)
    expect(meterHeight(0.2)).toBeLessThan(100)
    expect(meterHeight(1)).toBe(100)
  })
})
