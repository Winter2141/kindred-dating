import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useRecordView } from './views'

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(api, 'recordView').mockResolvedValue()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useRecordView', () => {
  it('records a profile kept open long enough, once', () => {
    const { rerender } = renderHook(({ id, open }) => useRecordView(id, open, 1000), {
      initialProps: { id: 7, open: true },
    })
    vi.advanceTimersByTime(999)
    expect(api.recordView).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(api.recordView).toHaveBeenCalledWith(7)

    rerender({ id: 7, open: false })
    rerender({ id: 7, open: true })
    vi.advanceTimersByTime(5000)
    expect(api.recordView).toHaveBeenCalledOnce()
  })

  it('ignores a profile closed or swiped past too soon', () => {
    const { rerender } = renderHook(({ id, open }) => useRecordView(id, open, 1000), {
      initialProps: { id: 7, open: true },
    })
    vi.advanceTimersByTime(500)
    rerender({ id: 8, open: true })
    vi.advanceTimersByTime(500)
    rerender({ id: 8, open: false })
    vi.advanceTimersByTime(5000)
    expect(api.recordView).not.toHaveBeenCalled()
  })

  it('does nothing without a profile', () => {
    renderHook(() => useRecordView(null, true, 10))
    vi.advanceTimersByTime(100)
    expect(api.recordView).not.toHaveBeenCalled()
  })
})
