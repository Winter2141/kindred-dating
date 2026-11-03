import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LikeCommentDialog, LikeCommentNote, likedItemKey } from './LikeComment'

const prompt = { question: 'My ideal Sunday', answer: 'Farmers market, then a nap' }

describe('likedItemKey', () => {
  it('names prompts the way the API expects', () => {
    expect(likedItemKey({ kind: 'prompt', prompt })).toBe('prompt:My ideal Sunday')
    expect(likedItemKey({ kind: 'profile' })).toBeUndefined()
  })
})

describe('LikeCommentDialog', () => {
  it('sends the comment with the prompt it is about', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<LikeCommentDialog name="Priya" target={{ kind: 'prompt', prompt }} onClose={vi.fn()} onSend={onSend} />)
    expect(screen.getByText('Farmers market, then a nap')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /like without a comment/i })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox'), '  A nap is non-negotiable ')
    await user.click(screen.getByRole('button', { name: /send like/i }))
    expect(onSend).toHaveBeenCalledWith({ kind: 'prompt', prompt }, 'A nap is non-negotiable')
  })
})

describe('LikeCommentNote', () => {
  it('shows the comment and what it was about', () => {
    render(
      <LikeCommentNote
        comment="Same!"
        item={{ kind: 'prompt', photo: null, question: 'My ideal Sunday', answer: 'Naps' }}
      />,
    )
    expect(screen.getByText('On “My ideal Sunday”')).toBeInTheDocument()
    expect(screen.getByText('“Same!”')).toBeInTheDocument()
  })

  it('renders nothing for a plain like', () => {
    const { container } = render(<LikeCommentNote comment={null} item={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
