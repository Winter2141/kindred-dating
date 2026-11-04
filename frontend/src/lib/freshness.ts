import type { QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * A live event just changed data that a request is still loading. That response was read
 * before the change and would land on top of it, undoing it (a just-sent message vanishing
 * from a chat that was still loading). Load it again instead: invalidating cancels the
 * request in flight and starts one that includes the change.
 */
export function refetchIfLoading(queryClient: QueryClient, queryKey: QueryKey): boolean {
  if (queryClient.isFetching({ queryKey, exact: true }) === 0) return false
  void queryClient.invalidateQueries({ queryKey, exact: true })
  return true
}
