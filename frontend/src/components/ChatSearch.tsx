import { useQuery } from '@tanstack/react-query'
import { SearchX } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { highlightParts, snippetAround, useDebounced } from '@/lib/search'
import { shortAgo } from '@/lib/time'
import type { SearchHit } from '@/lib/types'
import { Avatar, Spinner } from './ui'

/** Shortest query sent to the server; matches the API's minimum. */
export const MIN_SEARCH_LENGTH = 2

export function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded bg-apricot/25 px-0.5 text-apricot">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

/** Messages containing the query, under the conversation list while searching. */
export function MessageResults({ query, meId }: { query: string; meId?: number }) {
  const settled = useDebounced(query.trim(), 250)
  const enabled = settled.length >= MIN_SEARCH_LENGTH
  const results = useQuery({
    queryKey: keys.search(settled),
    queryFn: () => api.search(settled),
    enabled,
    staleTime: 10_000,
  })
  if (!enabled) return null

  const hits = results.data?.messages ?? []
  return (
    <section aria-label="Messages matching your search" className="mt-4">
      <p className="label flex items-center gap-2 px-3">
        Messages {results.isFetching && <Spinner className="size-3" />}
      </p>
      {results.isSuccess && hits.length === 0 && (
        <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
          <SearchX className="size-4" /> No messages mention “{settled}”.
        </p>
      )}
      <ul className="space-y-0.5">
        {hits.map((hit) => (
          <li key={hit.message.id}>
            <HitRow hit={hit} query={settled} meId={meId} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function HitRow({ hit, query, meId }: { hit: SearchHit; query: string; meId?: number }) {
  const mine = hit.message.sender_id === meId
  return (
    <Link
      to={`/app/matches/${hit.match_id}?message=${hit.message.id}`}
      className="flex items-start gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-raised/60"
    >
      <Avatar src={hit.with_user.photos[0]} name={hit.with_user.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold">{hit.with_user.name}</p>
          <span className="shrink-0 text-xs text-faint">{shortAgo(hit.message.created_at)}</span>
        </div>
        <p className="line-clamp-2 text-sm text-muted">
          {mine && <span className="text-faint">You: </span>}
          <Highlighted text={snippetAround(hit.message.body, query)} query={query} />
        </p>
      </div>
    </Link>
  )
}
