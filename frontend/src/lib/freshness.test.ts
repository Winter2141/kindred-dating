import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { refetchIfLoading } from './freshness'

const KEY = ['messages', 7]

function slowThenFresh() {
  let finishFirst: (value: string[]) => void = () => {}
  let calls = 0
  const queryFn = vi.fn(() => {
    calls += 1
    if (calls === 1) return new Promise<string[]>((resolve) => (finishFirst = resolve))
    return Promise.resolve(['older', 'just sent'])
  })
  return { queryFn, finishFirst: (value: string[]) => finishFirst(value) }
}

describe('refetchIfLoading', () => {
  it('keeps a slow first load from wiping out what arrived meanwhile', async () => {
    const client = new QueryClient()
    const { queryFn, finishFirst } = slowThenFresh()
    const observer = new QueryObserver(client, { queryKey: KEY, queryFn })
    const unsubscribe = observer.subscribe(() => {})
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce())

    // The live event lands while the first request is still out...
    client.setQueryData<string[]>(KEY, (list) => [...(list ?? []), 'just sent'])
    expect(refetchIfLoading(client, KEY)).toBe(true)
    // ...and that request, read before the message existed, comes back late.
    finishFirst(['older'])

    await vi.waitFor(() => expect(client.getQueryData(KEY)).toEqual(['older', 'just sent']))
    expect(queryFn).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('leaves settled data alone', async () => {
    const client = new QueryClient()
    const queryFn = vi.fn(async () => ['older'])
    await client.fetchQuery({ queryKey: KEY, queryFn })
    expect(refetchIfLoading(client, KEY)).toBe(false)
    expect(queryFn).toHaveBeenCalledOnce()
  })
})
