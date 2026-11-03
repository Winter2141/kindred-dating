import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { AppearanceSection } from '@/pages/Settings'
import { usePrefs } from '@/store/prefs'
import { applyTheme, resolveTheme, watchTheme } from './theme'

afterEach(() => {
  usePrefs.getState().setTheme('dark')
  applyTheme('dark')
})

describe('resolveTheme', () => {
  it('follows the device only when asked to', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('applyTheme', () => {
  it('sets the attribute, colour scheme and browser colour', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.append(meta)
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(meta.content).toBe('#faf6f3')
    meta.remove()
  })

  it('stops following the device once a theme is picked', () => {
    const stop = watchTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    stop()
  })
})

describe('AppearanceSection', () => {
  it('saves the choice', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppearanceSection />
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(usePrefs.getState().theme).toBe('light')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
  })
})
