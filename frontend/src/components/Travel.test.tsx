import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { addDays, isoDay } from '@/lib/travel'
import type { Me } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { TravelButton, VisitingBadge } from './Travel'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      startTrip: vi.fn(),
      endTrip: vi.fn(),
      places: vi.fn(),
    },
  }
})

const TODAY = isoDay(new Date())
const ME = {
  id: 1,
  name: 'Alex',
  city: 'Brooklyn, NY',
  email: 'alex@kindred.app',
  travel: null,
} as Me

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function Live() {
  const user = useAuth((s) => s.user)
  return user ? <TravelButton user={user} /> : null
}

beforeEach(() => {
  useAuth.getState().setUser(ME)
  vi.mocked(api.startTrip).mockReset()
  vi.mocked(api.endTrip).mockReset()
  vi.mocked(api.places).mockReset().mockResolvedValue(['Lisbon, Portugal'])
})

afterEach(() => useAuth.getState().signOut())

describe('TravelButton', () => {
  it('starts a trip to a place on a day', async () => {
    const until = addDays(TODAY, 6)
    vi.mocked(api.startTrip).mockResolvedValue({
      ...ME,
      travel: { place: 'Lisbon, Portugal', until },
      visiting: 'Lisbon, Portugal',
    })
    const user = userEvent.setup()
    render(wrap(<Live />))

    await user.click(screen.getByRole('button', { name: 'Travel mode' }))
    expect(screen.getByLabelText('Last day there')).toHaveValue(addDays(TODAY, 4))
    await user.type(screen.getByLabelText('Where to'), 'Lisbon, Portugal')
    const day = screen.getByLabelText('Last day there')
    await user.clear(day)
    await user.type(day, until)
    await user.click(screen.getByRole('button', { name: /start exploring/i }))

    expect(api.startTrip).toHaveBeenCalledWith('Lisbon, Portugal', until)
    // The dialog closes and the button shows the trip is on.
    expect(
      await screen.findByRole('button', {
        name: 'Travel mode: Lisbon, Portugal',
      }),
    ).toBeInTheDocument()
  })

  it("refuses a day that's too far off before asking the server", async () => {
    const user = userEvent.setup()
    render(wrap(<Live />))
    await user.click(screen.getByRole('button', { name: 'Travel mode' }))
    await user.type(screen.getByLabelText('Where to'), 'Lisbon')
    const day = screen.getByLabelText('Last day there')
    await user.clear(day)
    await user.type(day, addDays(TODAY, 45))
    expect(screen.getByRole('status')).toHaveTextContent('Pick a day between today and 30 days from now.')
    expect(screen.getByRole('button', { name: /start exploring/i })).toBeDisabled()
  })

  it("shows the server's answer when a place is refused", async () => {
    vi.mocked(api.startTrip).mockRejectedValue(new Error("That's where you live"))
    const user = userEvent.setup()
    render(wrap(<Live />))
    await user.click(screen.getByRole('button', { name: 'Travel mode' }))
    await user.type(screen.getByLabelText('Where to'), 'Brooklyn')
    await user.click(screen.getByRole('button', { name: /start exploring/i }))
    expect(await screen.findByText("That's where you live")).toBeInTheDocument()
  })

  it('shows a trip in progress and ends it', async () => {
    useAuth.getState().setUser({
      ...ME,
      travel: { place: 'Paris, France', until: addDays(TODAY, 2) },
    })
    vi.mocked(api.endTrip).mockResolvedValue(ME)
    const user = userEvent.setup()
    render(wrap(<Live />))

    await user.click(screen.getByRole('button', { name: 'Travel mode: Paris, France' }))
    expect(screen.getByText(/2 more days/)).toBeInTheDocument()
    expect(screen.getByLabelText('Where to')).toHaveValue('Paris, France')
    expect(screen.getByRole('button', { name: /update trip/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /end trip/i }))
    expect(api.endTrip).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Travel mode' })).toBeInTheDocument()
  })
})

describe('VisitingBadge', () => {
  it('names the city without the country', () => {
    render(<VisitingBadge place="Lisbon, Portugal" />)
    expect(screen.getByText(/Visiting Lisbon$/)).toHaveAttribute('title', 'Visiting Lisbon, Portugal')
  })
})
