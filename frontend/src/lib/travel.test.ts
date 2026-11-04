import { describe, expect, it } from 'vitest'
import { addDays, daysLeft, isoDay, shortPlace, tripBounds, tripRemaining } from './travel'

const NOW = new Date('2026-11-04T15:30:00Z')

describe('trip dates', () => {
  it('counts in UTC days', () => {
    expect(isoDay(NOW)).toBe('2026-11-04')
    expect(addDays('2026-11-28', 5)).toBe('2026-12-03')
    expect(tripBounds(NOW)).toEqual({ min: '2026-11-04', max: '2026-12-04' })
  })

  it('counts today as a day left', () => {
    expect(daysLeft('2026-11-04', NOW)).toBe(1)
    expect(daysLeft('2026-11-06', NOW)).toBe(3)
    expect(daysLeft('2026-11-01', NOW)).toBe(0)
  })

  it('says how much of the trip is left', () => {
    expect(tripRemaining('2026-11-04', NOW)).toBe('last day today')
    expect(tripRemaining('2026-11-05', NOW)).toBe('1 more day')
    expect(tripRemaining('2026-11-10', NOW)).toBe('6 more days')
  })

  it('shortens a place for a badge', () => {
    expect(shortPlace('Lisbon, Portugal')).toBe('Lisbon')
    expect(shortPlace('Brooklyn')).toBe('Brooklyn')
  })
})
