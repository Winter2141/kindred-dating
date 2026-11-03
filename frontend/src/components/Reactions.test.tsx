import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ReactionChips, ReactionPicker, groupReactions } from './Reactions'

describe('groupReactions', () => {
  it('counts each emoji and notes my own', () => {
    const groups = groupReactions(
      [
        { user_id: 1, emoji: '❤️' },
        { user_id: 2, emoji: '😂' },
        { user_id: 3, emoji: '❤️' },
      ],
      3,
    )
    expect(groups).toEqual([
      { emoji: '❤️', count: 2, mine: true },
      { emoji: '😂', count: 1, mine: false },
    ])
    expect(groupReactions(undefined, 1)).toEqual([])
  })
})

describe('ReactionChips', () => {
  it('toggles a reaction when its chip is tapped', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(<ReactionChips reactions={[{ user_id: 1, emoji: '🔥' }]} meId={1} onToggle={onToggle} align="left" />)
    const chip = screen.getByRole('button', { name: '🔥 1, including you' })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    await user.click(chip)
    expect(onToggle).toHaveBeenCalledWith('🔥')
  })
})

describe('ReactionPicker', () => {
  it('offers the quick reactions and closes after picking', async () => {
    const onPick = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReactionPicker open onOpenChange={onOpenChange} onPick={onPick} align="left" />
      </QueryClientProvider>,
    )
    expect(screen.getAllByRole('menuitem')).toHaveLength(6)
    await user.click(screen.getByRole('menuitem', { name: 'React 😂' }))
    expect(onPick).toHaveBeenCalledWith('😂')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
