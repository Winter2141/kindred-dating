import { describe, expect, it } from 'vitest'
import { activeDate, buildIcs, defaultDateTime, toLocalInput, upsertDate } from './dates'
import type { DateProposal } from './types'

const date = (overrides: Partial<DateProposal>): DateProposal => ({
  id: 1,
  match_id: 4,
  proposer_id: 1,
  place: 'Blue Bottle, Williamsburg',
  starts_at: '2026-11-05T19:30:00Z',
  note: '',
  status: 'proposed',
  created_at: '2026-11-02T10:00:00Z',
  responded_at: null,
  ...overrides,
})

describe('upsertDate', () => {
  it('replaces by id and keeps order', () => {
    const list = [date({ id: 1 }), date({ id: 2 })]
    expect(upsertDate(list, date({ id: 1, status: 'accepted' }))?.map((d) => [d.id, d.status])).toEqual([
      [1, 'accepted'],
      [2, 'proposed'],
    ])
    expect(upsertDate([], date({ id: 3 }))?.map((d) => d.id)).toEqual([3])
    expect(upsertDate(undefined, date({}))).toBeUndefined()
  })
})

describe('activeDate', () => {
  const now = new Date('2026-11-03T12:00:00Z')
  it('surfaces an open proposal or a date still to come', () => {
    expect(activeDate([date({ status: 'proposed' })], now)?.status).toBe('proposed')
    expect(activeDate([date({ status: 'accepted' })], now)?.status).toBe('accepted')
    expect(activeDate([date({ status: 'accepted', starts_at: '2026-11-01T19:00:00Z' })], now)).toBeNull()
    expect(activeDate([date({ status: 'declined' })], now)).toBeNull()
    expect(activeDate([], now)).toBeNull()
  })
})

describe('date inputs', () => {
  it('formats for datetime-local and defaults to tomorrow evening', () => {
    expect(toLocalInput(new Date(2026, 10, 2, 9, 5))).toBe('2026-11-02T09:05')
    expect(defaultDateTime(new Date(2026, 10, 30, 22, 0))).toBe('2026-12-01T19:00')
  })
})

describe('buildIcs', () => {
  it('writes a two-hour calendar event with escaped text', () => {
    const ics = buildIcs(date({ id: 9, note: 'Bring the map; seriously' }), 'Maya', new Date('2026-11-02T10:00:00Z'))
    const lines = ics.split('\r\n')
    expect(lines).toContain('DTSTART:20261105T193000Z')
    expect(lines).toContain('DTEND:20261105T213000Z')
    expect(lines).toContain('SUMMARY:Date with Maya')
    expect(lines).toContain('LOCATION:Blue Bottle\\, Williamsburg')
    expect(lines).toContain('DESCRIPTION:Bring the map\\; seriously')
    expect(lines).toContain('UID:kindred-date-9@kindred.app')
  })
})
