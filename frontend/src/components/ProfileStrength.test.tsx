import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StrengthCard, strengthLabel } from './ProfileStrength'

describe('strengthLabel', () => {
  it('names the bands', () => {
    expect(strengthLabel(10)).toBe('Just started')
    expect(strengthLabel(55)).toBe('Getting there')
    expect(strengthLabel(80)).toBe('Strong')
    expect(strengthLabel(100)).toBe('Standout')
  })
})

describe('StrengthCard', () => {
  it('shows the score and the top three tips', () => {
    const tips = ['photos', 'prompts', 'bio', 'work'].map((key, i) => ({ key, text: `Tip ${key}`, points: 20 - i }))
    render(<StrengthCard strength={{ score: 45, tips }} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45')
    expect(screen.getByText('Getting there')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('+20')).toBeInTheDocument()
    expect(screen.queryByText('Tip work')).not.toBeInTheDocument()
  })

  it('celebrates a complete profile', () => {
    render(<StrengthCard strength={{ score: 100, tips: [] }} />)
    expect(screen.getByText(/everything it needs/i)).toBeInTheDocument()
  })
})
