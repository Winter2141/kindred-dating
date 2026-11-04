import { describe, expect, it } from 'vitest'
import { hourIn, hourLabel, inWindow, isQuietNow, quietSummary } from './quiet'

describe('quiet hours', () => {
  it('reads the hour in another time zone', () => {
    const noonUtc = new Date('2026-11-04T12:00:00Z')
    expect(hourIn('UTC', noonUtc)).toBe(12)
    expect(hourIn('America/New_York', noonUtc)).toBe(7)
    expect(hourIn('Asia/Tokyo', noonUtc)).toBe(21)
  })

  it('handles windows that wrap past midnight', () => {
    expect(inWindow(23, 22, 8)).toBe(true)
    expect(inWindow(3, 22, 8)).toBe(true)
    expect(inWindow(8, 22, 8)).toBe(false)
    expect(inWindow(13, 12, 14)).toBe(true)
    expect(inWindow(14, 12, 14)).toBe(false)
    expect(inWindow(5, 5, 5)).toBe(false)
  })

  it('is quiet at night where the person is, not where the server is', () => {
    const quiet = { start: 22, end: 8, timezone: 'America/New_York' }
    expect(isQuietNow(quiet, new Date('2026-11-04T04:00:00Z'))).toBe(true) // 11 pm in New York
    expect(isQuietNow(quiet, new Date('2026-11-04T15:00:00Z'))).toBe(false) // 10 am
    expect(isQuietNow(null)).toBe(false)
    expect(isQuietNow({ ...quiet, timezone: 'Not/AZone' })).toBe(false)
  })

  it('labels hours the way people say them', () => {
    expect(hourLabel(0)).toBe('12 am')
    expect(hourLabel(12)).toBe('12 pm')
    expect(hourLabel(22)).toBe('10 pm')
    expect(quietSummary({ start: 22, end: 8 })).toBe('10 pm to 8 am (10 hours)')
    expect(quietSummary({ start: 13, end: 14 })).toBe('1 pm to 2 pm (1 hour)')
  })
})
