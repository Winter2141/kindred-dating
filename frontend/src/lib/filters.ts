/** Discover filters: what's chosen, how many are on, and how they go over the wire. */

export interface DiscoverFilters {
  verifiedOnly: boolean
  /** Only people active in the last N days. */
  activeWithinDays: number | null
  /** Anyone into at least one of these. */
  interests: string[]
  withPrompts: boolean
  /** Minimum question agreement, 0-100. */
  minAgreement: number | null
}

export const NO_FILTERS: DiscoverFilters = {
  verifiedOnly: false,
  activeWithinDays: null,
  interests: [],
  withPrompts: false,
  minAgreement: null,
}

export const ACTIVE_WITHIN_OPTIONS = [
  { value: null, label: 'Any time' },
  { value: 1, label: 'Today' },
  { value: 3, label: '3 days' },
  { value: 7, label: 'This week' },
] as const

export const AGREEMENT_OPTIONS = [null, 50, 70, 85] as const

/** How many filters are switched on, for the badge on the Filters button. */
export function activeFilterCount(filters: DiscoverFilters): number {
  return (
    Number(filters.verifiedOnly) +
    Number(filters.activeWithinDays !== null) +
    Number(filters.interests.length > 0) +
    Number(filters.withPrompts) +
    Number(filters.minAgreement !== null)
  )
}

/** Query string for GET /api/discover; empty when nothing is filtered. */
export function filtersToQuery(filters: DiscoverFilters): string {
  const params = new URLSearchParams()
  if (filters.verifiedOnly) params.set('verified_only', 'true')
  if (filters.activeWithinDays !== null) params.set('active_within_days', String(filters.activeWithinDays))
  for (const interest of filters.interests) params.append('interests', interest)
  if (filters.withPrompts) params.set('with_prompts', 'true')
  if (filters.minAgreement !== null) params.set('min_agreement', String(filters.minAgreement))
  const query = params.toString()
  return query ? `?${query}` : ''
}
