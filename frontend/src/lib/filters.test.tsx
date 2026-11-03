import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FiltersButton } from '@/components/DiscoverFilters'
import { usePrefs } from '@/store/prefs'
import { api } from './api'
import { NO_FILTERS, activeFilterCount, filtersToQuery } from './filters'

beforeEach(() => usePrefs.getState().setDiscoverFilters(NO_FILTERS))
afterEach(() => vi.restoreAllMocks())

describe('filtersToQuery', () => {
  it('is empty without filters', () => {
    expect(filtersToQuery(NO_FILTERS)).toBe('')
  })

  it('encodes every filter, repeating interests', () => {
    const query = filtersToQuery({
      verifiedOnly: true,
      activeWithinDays: 3,
      interests: ['Live music', 'Books'],
      withPrompts: true,
      minAgreement: 70,
    })
    expect(query).toBe(
      '?verified_only=true&active_within_days=3&interests=Live+music&interests=Books&with_prompts=true&min_agreement=70',
    )
  })
})

describe('activeFilterCount', () => {
  it('counts each kind of filter once', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...NO_FILTERS, interests: ['Books', 'Film'], verifiedOnly: true })).toBe(2)
  })
})

describe('FiltersButton', () => {
  it('switches filters on, counts them and resets', async () => {
    vi.spyOn(api, 'meta').mockResolvedValue({
      interests: [{ name: 'Books', emoji: '📚' }],
      prompt_questions: [],
      genders: [],
      max_interests: 8,
      max_prompts: 3,
      max_photos: 6,
      reactions: [],
    })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FiltersButton />
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('switch', { name: /verified photos only/i }))
    await user.click(within(dialog).getByRole('button', { name: 'This week' }))
    await user.click(await within(dialog).findByRole('button', { name: /books/i }))

    expect(usePrefs.getState().discoverFilters).toMatchObject({
      verifiedOnly: true,
      activeWithinDays: 7,
      interests: ['Books'],
    })
    expect(screen.getByRole('button', { name: 'Filters (3 on)' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Reset' }))
    expect(usePrefs.getState().discoverFilters).toEqual(NO_FILTERS)
  })
})
