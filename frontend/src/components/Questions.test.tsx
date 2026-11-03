import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { nextUnanswered } from '@/lib/questions'
import type { QuestionCatalog } from '@/lib/types'
import { AgreementPanel, QuestionsCard } from './Questions'

afterEach(() => vi.restoreAllMocks())

const catalog = (answers: QuestionCatalog['answers'] = {}): QuestionCatalog => ({
  questions: [
    { id: 'kids', text: 'Do you want children someday?', options: ['Yes', 'No', 'Not sure yet'], topic: 'Life' },
    { id: 'pets', text: 'Could you live with a pet?', options: ['Love to', "If it's small", 'Rather not'], topic: 'Life' },
  ],
  importance_labels: ['A little', 'Somewhat', 'Very'],
  min_common: 3,
  answers,
})

function wrap(children: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

describe('nextUnanswered', () => {
  it('walks the catalog, skipping answered and skipped questions', () => {
    expect(nextUnanswered(catalog())?.id).toBe('kids')
    expect(nextUnanswered(catalog(), ['kids'])?.id).toBe('pets')
    expect(nextUnanswered(catalog({ kids: { answer: 0, acceptable: [0], importance: 1 } }))?.id).toBe('pets')
    expect(nextUnanswered(catalog(), ['kids', 'pets'])).toBeUndefined()
  })
})

describe('QuestionsCard', () => {
  it('answers a question with what you accept and how much it matters', async () => {
    vi.spyOn(api, 'questions').mockResolvedValue(catalog())
    const save = vi.spyOn(api, 'answerQuestion').mockResolvedValue({ answer: 0, acceptable: [0, 2], importance: 2 })
    const user = userEvent.setup()
    render(wrap(<QuestionsCard />))

    expect(await screen.findByText('0 of 2 answered')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /start answering/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Do you want children someday?')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'Yes' }))
    await user.click(within(dialog).getByRole('button', { name: 'No' }))
    await user.click(within(dialog).getByRole('button', { name: 'Very' }))
    await user.click(within(dialog).getByRole('button', { name: /save/i }))

    expect(save).toHaveBeenCalledWith('kids', { answer: 0, acceptable: [0, 2], importance: 2 })
    expect(await within(dialog).findByText('Could you live with a pet?')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 answered')).toBeInTheDocument()
  })

  it('always keeps at least one acceptable answer', async () => {
    vi.spyOn(api, 'questions').mockResolvedValue(catalog())
    const user = userEvent.setup()
    render(wrap(<QuestionsCard />))
    await user.click(await screen.findByRole('button', { name: /start answering/i }))
    const dialog = screen.getByRole('dialog')
    for (const name of ['Yes', 'No', 'Not sure yet']) {
      await user.click(within(dialog).getByRole('button', { name }))
    }
    expect(within(dialog).getByRole('button', { name: 'Not sure yet' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('AgreementPanel', () => {
  it('shows the score and the answers you share', async () => {
    vi.spyOn(api, 'agreement').mockResolvedValue({
      percent: 86,
      common: 5,
      same: [{ question: 'Do you want children someday?', answer: 'Yes' }],
    })
    render(wrap(<AgreementPanel userId={4} />))
    expect(await screen.findByText('86% agree')).toBeInTheDocument()
    expect(screen.getByText('You both said yes.')).toBeInTheDocument()
  })

  it('stays hidden with nothing to show', async () => {
    const spy = vi.spyOn(api, 'agreement').mockResolvedValue({ percent: null, common: 1, same: [] })
    const { container } = render(wrap(<AgreementPanel userId={4} />))
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
