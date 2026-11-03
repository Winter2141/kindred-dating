import { describe, expect, it } from 'vitest'
import { previewText } from './photos'
import { quoteText } from './quotes'
import { WAVEFORM_BARS, formatDuration, pickMimeType, rms, toWaveform } from './voice'

describe('formatDuration', () => {
  it('shows minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(4200)).toBe('0:04')
    expect(formatDuration(75_000)).toBe('1:15')
    expect(formatDuration(-10)).toBe('0:00')
  })
})

describe('toWaveform', () => {
  it('makes a fixed number of bars normalised to the loudest moment', () => {
    const bars = toWaveform([0.05, 0.1, 0.2, 0.4, 0.1, 0.05])
    expect(bars).toHaveLength(WAVEFORM_BARS)
    expect(Math.max(...bars)).toBe(100)
    expect(Math.min(...bars)).toBeGreaterThan(0)
  })

  it('is flat for silence', () => {
    expect(toWaveform([])).toEqual(Array(WAVEFORM_BARS).fill(0))
    expect(toWaveform([0, 0, 0], 4)).toEqual([0, 0, 0, 0])
  })
})

describe('rms', () => {
  it('is zero for silence and grows with amplitude', () => {
    expect(rms(new Uint8Array([128, 128, 128]))).toBe(0)
    const quiet = rms(new Uint8Array([120, 136, 120, 136]))
    const loud = rms(new Uint8Array([20, 236, 20, 236]))
    expect(loud).toBeGreaterThan(quiet)
    expect(rms(new Uint8Array())).toBe(0)
  })
})

describe('pickMimeType', () => {
  it('prefers WebM/Opus and falls back to MP4 for Safari', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus')
    expect(pickMimeType((type) => type === 'audio/mp4')).toBe('audio/mp4')
    expect(pickMimeType(() => false)).toBeUndefined()
  })
})

describe('labels', () => {
  it('names voice notes in previews and quotes', () => {
    expect(previewText({ body: '', audio_url: '/media/voice-1.webm' })).toBe('🎤 Voice note')
    expect(
      quoteText({ id: 1, sender_id: 2, body: '', image_url: null, audio_url: '/media/v.webm', deleted_at: null }),
    ).toBe('🎤 Voice note')
  })
})
