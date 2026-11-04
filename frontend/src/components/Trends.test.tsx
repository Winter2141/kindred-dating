import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { TrendDay, Trends } from '@/lib/types'
import { ModerationTrends, TrendsView, waitLabel } from './Trends'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, moderationTrends: vi.fn() } }
})

function day(date: string, filed: number, resolved: number, members = 0): TrendDay {
  return { day: date, reports_filed: filed, reports_resolved: resolved, new_members: members }
}

const TRENDS: Trends = {
  days: 7,
  reports_filed: 5,
  reports_resolved: 3,
  new_members: 4,
  median_hours_to_resolve: 5.4,
  oldest_open_hours: 60,
  by_reason: [
    { reason: 'harassment', count: 3 },
    { reason: 'spam', count: 2 },
  ],
  activity: [
    day('2026-10-28', 0, 0),
    day('2026-10-29', 2, 0, 1),
    day('2026-10-30', 0, 1),
    day('2026-10-31', 1, 0, 2),
    day('2026-11-01', 0, 0),
    day('2026-11-02', 2, 1, 1),
    day('2026-11-03', 0, 1),
  ],
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.mocked(api.moderationTrends).mockReset().mockResolvedValue(TRENDS)
})

describe('waitLabel', () => {
  it('reads naturally at every scale', () => {
    expect(waitLabel(null)).toBe('–')
    expect(waitLabel(0.4)).toBe('Under an hour')
    expect(waitLabel(5.4)).toBe('5 h')
    expect(waitLabel(60)).toBe('2.5 days')
  })
})

describe('TrendsView', () => {
  it('sums up the queue in tiles', () => {
    render(<TrendsView data={TRENDS} />)
    expect(screen.getByText('3 resolved · queue grew by 2')).toBeInTheDocument()
    expect(screen.getByText('5 h')).toBeInTheDocument()
    expect(screen.getByText('2.5 days')).toBeInTheDocument()
  })

  it('labels every day for screen readers and shows both numbers on hover', () => {
    render(<TrendsView data={TRENDS} />)
    const busy = screen.getByRole('button', { name: /2 filed, 1 resolved$/ })
    fireEvent.mouseEnter(busy)
    const tooltip = screen.getByRole('tooltip')
    expect(within(tooltip).getByText('2')).toBeInTheDocument()
    expect(within(tooltip).getByText('1')).toBeInTheDocument()
  })

  it('has a legend for the two report series, with totals', () => {
    render(<TrendsView data={TRENDS} />)
    const legend = screen.getByLabelText('Legend')
    expect(legend).toHaveTextContent('Filed 5')
    expect(legend).toHaveTextContent('Resolved 3')
  })

  it('names report reasons the way members chose them', () => {
    render(<TrendsView data={TRENDS} />)
    const reasons = screen.getByRole('list', { name: 'Reports by reason' })
    expect(within(reasons).getByText('Harassment')).toBeInTheDocument()
    expect(within(reasons).getByText('Spam or scam')).toBeInTheDocument()
  })

  it('says so when a chart has nothing in it', () => {
    render(<TrendsView data={{ ...TRENDS, new_members: 0, activity: TRENDS.activity.map((d) => ({ ...d, new_members: 0 })) }} />)
    expect(screen.getByText('Nothing in this period')).toBeInTheDocument()
  })

  it('reports an empty queue plainly', () => {
    render(<TrendsView data={{ ...TRENDS, oldest_open_hours: null, by_reason: [] }} />)
    expect(screen.getByText('Nothing open right now')).toBeInTheDocument()
    expect(screen.getByText('No reports in this period.')).toBeInTheDocument()
  })
})

describe('ModerationTrends', () => {
  it('loads two weeks first and switches range', async () => {
    const user = userEvent.setup()
    render(wrap(<ModerationTrends />))
    expect(await screen.findByText('Reports, day by day')).toBeInTheDocument()
    expect(api.moderationTrends).toHaveBeenCalledWith(14)
    await user.click(screen.getByRole('button', { name: '30 days' }))
    expect(api.moderationTrends).toHaveBeenLastCalledWith(30)
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true')
  })
})
