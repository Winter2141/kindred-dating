import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Insights } from '@/lib/types'
import { DailyBars, InsightsView, percent, replySpeed } from './Insights'

const DAYS = [
  { day: '2026-11-01', likes_received: 2, matches: 0, messages: 5 },
  { day: '2026-11-02', likes_received: 4, matches: 1, messages: 12 },
]

const DATA: Insights = {
  days: 7,
  likes_sent: 10,
  passes_sent: 4,
  likes_received: 6,
  super_likes_received: 1,
  matches: 1,
  match_rate: 0.1,
  messages_sent: 9,
  messages_received: 8,
  reply_rate: 0.75,
  median_reply_minutes: 95,
  liked_by_interests: [
    { interest: 'Coffee', count: 4 },
    { interest: 'Hiking', count: 2 },
  ],
  activity: DAYS,
}

describe('formatting', () => {
  it('turns rates and reply times into words', () => {
    expect(percent(0.756)).toBe('76%')
    expect(percent(null)).toBe('–')
    expect(replySpeed(null)).toBe('No replies yet')
    expect(replySpeed(0)).toBe('Usually replies right away')
    expect(replySpeed(25)).toBe('Usually within 25 min')
    expect(replySpeed(95)).toBe('Usually within 2 h')
  })
})

describe('DailyBars', () => {
  it('labels every bar and shows the value on hover', async () => {
    const user = userEvent.setup()
    render(<DailyBars series="messages" days={DAYS} />)
    expect(screen.getByText('17 total')).toBeInTheDocument()
    const bar = screen.getByRole('button', { name: /12 messages/ })
    await user.hover(bar)
    expect(screen.getByRole('tooltip')).toHaveTextContent('12')
    await user.unhover(bar)
  })
})

describe('InsightsView', () => {
  it('shows the headline numbers, the charts and a table view', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InsightsView data={DATA} />
      </QueryClientProvider>,
    )
    expect(screen.getByText('10% of your 10 likes')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Usually within 2 h')).toBeInTheDocument()
    expect(screen.getAllByRole('figure')).toHaveLength(3)
    expect(screen.getByText('View as table')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
