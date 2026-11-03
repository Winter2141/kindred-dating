import clsx from 'clsx'
import { SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import {
  ACTIVE_WITHIN_OPTIONS,
  AGREEMENT_OPTIONS,
  NO_FILTERS,
  activeFilterCount,
  type DiscoverFilters,
} from '@/lib/filters'
import { usePrefs } from '@/store/prefs'
import { Segmented } from './ProfileFields'
import { Dialog, InterestChip, Switch, useMeta } from './ui'

/** The Filters button on Discover, with a count of what's switched on. */
export function FiltersButton() {
  const filters = usePrefs((s) => s.discoverFilters)
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(filters)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          'relative grid size-11 place-items-center rounded-full border transition',
          count ? 'border-coral/50 bg-coral/12 text-apricot' : 'border-line-strong bg-raised text-muted hover:text-cream',
        )}
        aria-label={count ? `Filters (${count} on)` : 'Filters'}
        title="Filters"
      >
        <SlidersHorizontal className="size-4.5" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-gradient-brand text-[11px] font-bold text-ink">
            {count}
          </span>
        )}
      </button>
      <FiltersDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function FiltersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const filters = usePrefs((s) => s.discoverFilters)
  const setFilters = usePrefs((s) => s.setDiscoverFilters)
  const { data: meta } = useMeta()
  const update = (changes: Partial<DiscoverFilters>) => setFilters({ ...filters, ...changes })
  const toggleInterest = (name: string) =>
    update({
      interests: filters.interests.includes(name)
        ? filters.interests.filter((i) => i !== name)
        : [...filters.interests, name],
    })

  return (
    <Dialog open={open} onClose={onClose} title="Filters" wide>
      <div className="space-y-7">
        <p className="text-sm text-muted">
          These narrow your deck on top of the age, gender and distance preferences on your profile.
        </p>

        <div className="flex flex-col gap-4">
          <Switch checked={filters.verifiedOnly} onChange={(on) => update({ verifiedOnly: on })} label="Verified photos only" />
          <Switch checked={filters.withPrompts} onChange={(on) => update({ withPrompts: on })} label="Has answered prompts" />
        </div>

        <div>
          <span className="label">Active</span>
          <Segmented
            label="Active"
            value={[String(filters.activeWithinDays)]}
            onChange={([value]) => update({ activeWithinDays: value === 'null' ? null : Number(value) })}
            options={ACTIVE_WITHIN_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          />
        </div>

        <div>
          <span className="label">Agree on questions</span>
          <Segmented
            label="Agree on questions"
            value={[String(filters.minAgreement)]}
            onChange={([value]) => update({ minAgreement: value === 'null' ? null : Number(value) })}
            options={AGREEMENT_OPTIONS.map((v) => ({ value: String(v), label: v === null ? 'Any' : `${v}%+` }))}
          />
          <p className="mt-2 text-xs text-faint">People who haven't answered enough questions are hidden when this is on.</p>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label mb-0">Into any of</span>
            {filters.interests.length > 0 && (
              <button type="button" className="text-xs font-semibold text-coral hover:underline" onClick={() => update({ interests: [] })}>
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {meta?.interests.map((interest) => (
              <button
                key={interest.name}
                type="button"
                aria-pressed={filters.interests.includes(interest.name)}
                onClick={() => toggleInterest(interest.name)}
                className="rounded-full"
              >
                <InterestChip name={interest.name} emoji={interest.emoji} shared={filters.interests.includes(interest.name)} />
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
          <button
            type="button"
            className="btn-ghost"
            disabled={activeFilterCount(filters) === 0}
            onClick={() => setFilters(NO_FILTERS)}
          >
            Reset
          </button>
          <button type="button" className="btn-primary" onClick={onClose}>
            Show people
          </button>
        </div>
      </div>
    </Dialog>
  )
}
