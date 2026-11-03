import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { ExportButton } from './Settings'

afterEach(() => vi.restoreAllMocks())

describe('ExportButton', () => {
  it('downloads the export as a dated JSON file', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' })
    vi.spyOn(api, 'exportData').mockResolvedValue(blob)
    const createUrl = vi.fn(() => 'blob:export')
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ExportButton />
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('button', { name: /download my data/i }))
    await vi.waitFor(() => expect(click).toHaveBeenCalled())
    expect(createUrl).toHaveBeenCalledWith(blob)
    const link = click.mock.contexts[0] as HTMLAnchorElement
    expect(link.download).toMatch(/^kindred-export-\d{4}-\d{2}-\d{2}\.json$/)
  })
})
