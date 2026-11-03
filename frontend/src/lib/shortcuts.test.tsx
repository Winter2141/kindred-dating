import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ShortcutsDialog, useGlobalShortcuts } from '@/components/Shortcuts'
import { keys } from './cache'
import { createSequenceMatcher, isTyping, neighbour } from './shortcuts'
import type { Match } from './types'

describe('createSequenceMatcher', () => {
  it('matches g then a letter, only within the time window', () => {
    let now = 0
    const feed = createSequenceMatcher(1000, () => now)
    expect(feed('g')).toBeNull()
    expect(feed('c')).toBe('c')
    expect(feed('c')).toBeNull() // no g before it
    feed('g')
    now = 1500
    expect(feed('d')).toBeNull() // too slow
    feed('G')
    expect(feed('x')).toBeNull() // not a destination
  })
})

describe('neighbour', () => {
  it('steps through conversations and wraps around', () => {
    expect(neighbour([4, 7, 9], 7, 1)).toBe(9)
    expect(neighbour([4, 7, 9], 9, 1)).toBe(4)
    expect(neighbour([4, 7, 9], 4, -1)).toBe(9)
    expect(neighbour([4, 7, 9], null, 1)).toBe(4)
    expect(neighbour([], 3, 1)).toBeUndefined()
  })
})

describe('isTyping', () => {
  it('knows text fields', () => {
    const input = document.createElement('input')
    expect(isTyping(input)).toBe(true)
    expect(isTyping(document.createElement('button'))).toBe(false)
    expect(isTyping(null)).toBe(false)
  })
})

function Where() {
  return <p data-testid="path">{useLocation().pathname}</p>
}

function Harness() {
  const { helpOpen, setHelpOpen } = useGlobalShortcuts()
  return (
    <>
      <Where />
      <input aria-label="Some field" />
      <input aria-label="Search" data-shortcut="search" />
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  )
}

function renderAt(path: string) {
  const client = new QueryClient()
  client.setQueryData<Match[]>(keys.matches, [
    { id: 4, last_message: { id: 1 } } as Match,
    { id: 7, last_message: { id: 2 } } as Match,
    { id: 9, last_message: null } as Match,
  ])
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('useGlobalShortcuts', () => {
  it('opens help, jumps between pages and ignores typing', async () => {
    const user = userEvent.setup()
    renderAt('/app/discover')
    await user.keyboard('?')
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.keyboard('gc')
    expect(screen.getByTestId('path')).toHaveTextContent('/app/matches')

    await user.click(screen.getByLabelText('Some field'))
    await user.keyboard('gs')
    expect(screen.getByTestId('path')).toHaveTextContent('/app/matches')
  })

  it('searches and moves between chats with conversations', async () => {
    const user = userEvent.setup()
    renderAt('/app/matches/4')
    await user.keyboard('/')
    expect(screen.getByLabelText('Search')).toHaveFocus()
    await user.click(document.body)
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(screen.getByTestId('path')).toHaveTextContent('/app/matches/7')
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(screen.getByTestId('path')).toHaveTextContent('/app/matches/4') // 9 has no messages yet
  })
})
