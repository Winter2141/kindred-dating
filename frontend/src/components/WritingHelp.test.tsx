import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { AdminReport, Meta } from '@/lib/types'
import { BioHelper, MessageIdeasButton, ReportSummaryPanel, SourceNote } from './WritingHelp'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, meta: vi.fn(), bioIdeas: vi.fn(), messageIdeas: vi.fn(), reportSummary: vi.fn() },
  }
})

const META = { interests: [], prompt_questions: [], genders: [], reactions: [], ai_enabled: true } as unknown as Meta

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.mocked(api.meta).mockReset().mockResolvedValue(META)
  vi.mocked(api.bioIdeas).mockReset()
  vi.mocked(api.messageIdeas).mockReset()
  vi.mocked(api.reportSummary).mockReset()
})

describe('SourceNote', () => {
  it('labels AI writing, and explains the built-in fallback', () => {
    const { rerender } = render(<SourceNote source="ai" aiEnabled />)
    expect(screen.getByText(/Written with AI \(OpenAI\)/)).toBeInTheDocument()
    rerender(<SourceNote source="basic" aiEnabled />)
    expect(screen.getByText(/AI is busy right now/)).toBeInTheDocument()
    rerender(<SourceNote source="basic" aiEnabled={false} />)
    expect(screen.getByText(/With an OpenAI key set up/)).toBeInTheDocument()
  })
})

describe('BioHelper', () => {
  it('asks for bios in a tone and fills one in', async () => {
    vi.mocked(api.bioIdeas)
      .mockResolvedValueOnce({ ideas: ['Warm bio one', 'Warm bio two'], source: 'ai' })
      .mockResolvedValueOnce({ ideas: ['A funny bio'], source: 'ai' })
    const onUse = vi.fn()
    const user = userEvent.setup()
    render(wrap(<BioHelper draft="I like bikes" onUse={onUse} />))

    await user.click(screen.getByRole('button', { name: /help me write/i }))
    expect(api.bioIdeas).toHaveBeenCalledWith('I like bikes', 'warm')
    expect(await screen.findByRole('button', { name: 'Use this bio: Warm bio two' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Funny' }))
    expect(api.bioIdeas).toHaveBeenLastCalledWith('I like bikes', 'funny')
    await user.click(await screen.findByRole('button', { name: 'Use this bio: A funny bio' }))
    expect(onUse).toHaveBeenCalledWith('A funny bio')
    expect(screen.getByRole('button', { name: /help me write/i })).toBeInTheDocument()
  })

  it('shows an error without losing the panel', async () => {
    vi.mocked(api.bioIdeas).mockRejectedValue(new Error('Too many requests'))
    const user = userEvent.setup()
    render(wrap(<BioHelper draft="" onUse={vi.fn()} />))
    await user.click(screen.getByRole('button', { name: /help me write/i }))
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More ideas' })).toBeInTheDocument()
  })
})

describe('MessageIdeasButton', () => {
  it('suggests messages and puts the chosen one in the composer', async () => {
    vi.mocked(api.messageIdeas).mockResolvedValue({
      ideas: ['Which museum first?', 'Coffee this week?'],
      source: 'basic',
    })
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(wrap(<MessageIdeasButton matchId={4} name="Priya" onPick={onPick} />))

    await user.click(screen.getByRole('button', { name: 'Suggest a message' }))
    expect(api.messageIdeas).toHaveBeenCalledWith(4)
    expect(screen.getByRole('dialog', { name: 'Message ideas' })).toHaveTextContent('Ideas for Priya')
    await user.click(await screen.findByRole('button', { name: 'Use this message: Coffee this week?' }))
    expect(onPick).toHaveBeenCalledWith('Coffee this week?')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes with Escape', async () => {
    vi.mocked(api.messageIdeas).mockResolvedValue({ ideas: ['Hi!'], source: 'ai' })
    const user = userEvent.setup()
    render(wrap(<MessageIdeasButton matchId={4} name="Priya" onPick={vi.fn()} />))
    await user.click(screen.getByRole('button', { name: 'Suggest a message' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('ReportSummaryPanel', () => {
  const report = { id: 9 } as AdminReport

  it('summarises a report with a suggested action', async () => {
    vi.mocked(api.reportSummary).mockResolvedValue({
      summary: 'Kept messaging after no reply.',
      concerns: ['Pushy tone'],
      suggested_action: 'warn',
    })
    const user = userEvent.setup()
    render(wrap(<ReportSummaryPanel report={report} />))
    await user.click(await screen.findByRole('button', { name: /summarise with ai/i }))
    expect(api.reportSummary).toHaveBeenCalledWith(9)
    const panel = await screen.findByLabelText('AI summary')
    expect(panel).toHaveTextContent('Kept messaging after no reply.')
    expect(panel).toHaveTextContent('Suggests: warn')
    expect(panel).toHaveTextContent('Pushy tone')
  })

  it('stays hidden when AI is off', async () => {
    vi.mocked(api.meta).mockResolvedValue({ ...META, ai_enabled: false })
    const { container } = render(wrap(<ReportSummaryPanel report={report} />))
    await vi.waitFor(() => expect(api.meta).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
