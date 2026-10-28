import { describe, expect, it } from 'vitest'
import { describeError } from './api'
import { ageFromBirthdate, dayLabel, lastSeen, shortAgo } from './time'

const now = new Date(2026, 9, 28, 12, 0, 0)
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const MINUTE = 60_000

describe('shortAgo', () => {
  it('uses compact units', () => {
    expect(shortAgo(ago(20_000), now)).toBe('now')
    expect(shortAgo(ago(5 * MINUTE), now)).toBe('5m')
    expect(shortAgo(ago(3 * 60 * MINUTE), now)).toBe('3h')
    expect(shortAgo(ago(2 * 24 * 60 * MINUTE), now)).toBe('2d')
  })
})

describe('lastSeen', () => {
  it('prefers live presence', () => {
    expect(lastSeen(ago(10 * 24 * 60 * MINUTE), true, now)).toBe('Online now')
  })

  it('describes how long ago someone was active', () => {
    expect(lastSeen(ago(2 * MINUTE), false, now)).toBe('Active just now')
    expect(lastSeen(ago(40 * MINUTE), false, now)).toBe('Active 40m ago')
    expect(lastSeen(ago(30 * 60 * MINUTE), false, now)).toBe('Active yesterday')
    expect(lastSeen(ago(5 * 24 * 60 * MINUTE), false, now)).toBe('Active 5d ago')
  })
})

describe('dayLabel', () => {
  it('names recent days', () => {
    expect(dayLabel(new Date(2026, 9, 28, 8).toISOString(), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 27, 23).toISOString(), now)).toBe('Yesterday')
  })
})

describe('ageFromBirthdate', () => {
  it('counts birthdays correctly', () => {
    expect(ageFromBirthdate('1996-10-28', now)).toBe(30)
    expect(ageFromBirthdate('1996-10-29', now)).toBe(29)
  })
})

describe('describeError', () => {
  it('reads FastAPI string and validation errors', () => {
    expect(describeError('Wrong email or password')).toBe('Wrong email or password')
    expect(
      describeError([
        { loc: ['body', 'birthdate'], msg: 'Value error, you must be at least 18 to join' },
      ]),
    ).toBe('birthdate: you must be at least 18 to join')
    expect(describeError(undefined)).toBe('Something went wrong')
  })
})
