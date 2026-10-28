import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { keys } from '@/lib/cache'
import type { Meta } from '@/lib/types'
import { InterestPicker, Segmented } from './ProfileFields'

const META: Meta = {
  interests: [
    { name: 'Coffee', emoji: '☕' },
    { name: 'Hiking', emoji: '🥾' },
    { name: 'Vinyl', emoji: '💿' },
  ],
  prompt_questions: ['My ideal Sunday'],
  genders: ['woman', 'man', 'nonbinary'],
  max_interests: 2,
  max_prompts: 3,
  max_photos: 6,
}

function withMeta(children: ReactNode) {
  const client = new QueryClient()
  client.setQueryData(keys.meta, META)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function Picker() {
  const [value, setValue] = useState<string[]>([])
  return <InterestPicker value={value} onChange={setValue} />
}

describe('InterestPicker', () => {
  it('toggles interests and stops at the limit', async () => {
    const user = userEvent.setup()
    render(withMeta(<Picker />))

    await user.click(screen.getByRole('button', { name: /coffee/i }))
    await user.click(screen.getByRole('button', { name: /hiking/i }))

    expect(screen.getByText('2/2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /coffee/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /vinyl/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /coffee/i }))
    expect(screen.getByRole('button', { name: /vinyl/i })).toBeEnabled()
  })
})

function Genders({ multiple }: { multiple?: boolean }) {
  const [value, setValue] = useState(['woman'])
  return (
    <Segmented
      label="Show me"
      multiple={multiple}
      value={value}
      onChange={setValue}
      options={[
        { value: 'woman', label: 'Women' },
        { value: 'man', label: 'Men' },
      ]}
    />
  )
}

describe('Segmented', () => {
  it('switches the single choice', async () => {
    const user = userEvent.setup()
    render(<Genders />)
    await user.click(screen.getByRole('button', { name: 'Men' }))
    expect(screen.getByRole('button', { name: 'Men' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Women' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('never lets a multi-select go empty', async () => {
    const user = userEvent.setup()
    render(<Genders multiple />)
    await user.click(screen.getByRole('button', { name: 'Women' }))
    expect(screen.getByRole('button', { name: 'Women' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Men' }))
    await user.click(screen.getByRole('button', { name: 'Women' }))
    expect(screen.getByRole('button', { name: 'Women' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Men' })).toHaveAttribute('aria-pressed', 'true')
  })
})
