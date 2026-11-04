import { describe, expect, it } from 'vitest'
import { normalise, unkindPhrases } from './kindness'

// The same shapes backend/app/kindness.py builds; test_kindness.py checks the real list.
const PATTERNS = [
  String.raw`\bl+o+s+e+r+\b`,
  String.raw`\bs+h+u+t+\s+u+p+\b`,
  String.raw`(?:\b(?:y+o+u+|u+)(?:\s*'?\s*r+e*|\s+a+r+e+)?\s+)(?:(?:s+o+|r+e+a+l+y+)\s+)?u+g+l+y+\b`,
]

describe('normalise', () => {
  it('lowercases and undoes look-alike characters', () => {
    expect(normalise('L0$3R')).toBe('loser')
    expect(normalise('You’re')).toBe("you're")
  })
})

describe('unkindPhrases', () => {
  it('finds insults, in order', () => {
    expect(unkindPhrases("shuuut up, you're so ugly", PATTERNS)).toEqual(['shuuut up', "you're so ugly"])
    expect(unkindPhrases('what a L0SER', PATTERNS)).toEqual(['loser'])
  })

  it('leaves ordinary messages alone', () => {
    expect(unkindPhrases('Ugly sweater party on Friday?', PATTERNS)).toEqual([])
    expect(unkindPhrases('Shutters up already?', PATTERNS)).toEqual([])
    expect(unkindPhrases('', PATTERNS)).toEqual([])
  })

  it('finds every match when run again (no stale lastIndex)', () => {
    expect(unkindPhrases('loser', PATTERNS)).toEqual(['loser'])
    expect(unkindPhrases('loser', PATTERNS)).toEqual(['loser'])
  })

  it('skips a pattern this browser cannot compile instead of failing', () => {
    expect(unkindPhrases('loser', ['(', ...PATTERNS])).toEqual(['loser'])
  })

  it('does nothing before the patterns have loaded', () => {
    expect(unkindPhrases('loser', [])).toEqual([])
  })
})
