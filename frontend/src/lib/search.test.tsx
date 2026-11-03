import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Highlighted, MessageResults } from '@/components/ChatSearch'
import { api } from './api'
import { highlightParts, snippetAround } from './search'

afterEach(() => vi.restoreAllMocks())

describe('highlightParts', () => {
  it('splits out every case-insensitive hit', () => {
    expect(highlightParts('Ramen? RAMEN!', 'ramen')).toEqual([
      { text: 'Ramen', hit: true },
      { text: '? ', hit: false },
      { text: 'RAMEN', hit: true },
      { text: '!', hit: false },
    ])
  })

  it('leaves text alone without a query', () => {
    expect(highlightParts('hello', '  ')).toEqual([{ text: 'hello', hit: false }])
  })
})

describe('snippetAround', () => {
  const long = `${'Some long preamble about the weekend and the weather. '.repeat(3)}Then the ramen place on Elm came up and we talked about noodles for ages.`

  it('keeps short texts whole', () => {
    expect(snippetAround('Ramen tonight?', 'ramen')).toBe('Ramen tonight?')
  })

  it('starts close to the hit in long texts', () => {
    const snippet = snippetAround(long, 'ramen')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.toLowerCase().indexOf('ramen')).toBeLessThan(40)
    expect(snippet.length).toBeLessThanOrEqual(123)
  })
})

describe('Highlighted', () => {
  it('marks the hits', () => {
    const { container } = render(<Highlighted text="Coffee or tea? Coffee." query="coffee" />)
    expect(container.querySelectorAll('mark')).toHaveLength(2)
  })
})

describe('MessageResults', () => {
  it('lists matching messages linking to the message in its chat', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({
      query: 'ramen',
      people: [],
      messages: [
        {
          match_id: 3,
          with_user: { id: 9, name: 'Priya', photos: [] } as never,
          message: {
            id: 41,
            match_id: 3,
            sender_id: 9,
            body: 'Ramen tonight?',
            created_at: new Date().toISOString(),
            read_at: null,
          },
        },
      ],
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <MessageResults query="ramen" meId={1} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const link = await screen.findByRole('link', { name: /priya/i })
    expect(link).toHaveAttribute('href', '/app/matches/3?message=41')
    expect(link.querySelector('mark')?.textContent).toBe('Ramen')
  })
})
