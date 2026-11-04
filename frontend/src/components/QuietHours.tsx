import { useMutation } from '@tanstack/react-query'
import { Moon } from 'lucide-react'
import { useId } from 'react'
import { useSaveMe } from '@/components/EmailAddress'
import { Spinner, Switch } from '@/components/ui'
import { api } from '@/lib/api'
import { DEFAULT_QUIET, deviceTimezone, hourLabel, isQuietNow, quietSummary, type QuietHours } from '@/lib/quiet'
import type { Me } from '@/lib/types'
import { useToasts } from '@/store/live'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

/** Turn quiet hours on or off and pick the window. Each change saves straight away. */
export function QuietHoursForm({ user }: { user: Me }) {
  const saveMe = useSaveMe()
  const quiet = user.quiet_hours ?? null
  const save = useMutation({
    mutationFn: (next: QuietHours | null) => api.setQuietHours(next),
    onSuccess: saveMe,
    onError: (error) => useToasts.getState().push({ title: "Couldn't save quiet hours", body: error.message }),
  })
  const here = deviceTimezone()

  return (
    <div className="space-y-4">
      <Switch
        checked={quiet !== null}
        disabled={save.isPending}
        onChange={(on) => save.mutate(on ? { ...DEFAULT_QUIET, timezone: here } : null)}
        label="Quiet hours"
      />
      {quiet && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <HourSelect label="From" value={quiet.start} onChange={(start) => save.mutate({ ...quiet, start })} />
            <HourSelect label="Until" value={quiet.end} onChange={(end) => save.mutate({ ...quiet, end })} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            {save.isPending ? <Spinner className="size-3.5" /> : <Moon className="size-3.5 text-sky" />}
            <span>
              {quiet.start === quiet.end ? 'Pick two different hours.' : quietSummary(quiet)}, {quiet.timezone} time.
            </span>
            {isQuietNow(quiet) && <span className="font-semibold text-sky">Quiet right now.</span>}
          </p>
          {quiet.timezone !== here && (
            <button
              type="button"
              className="btn-ghost text-sm"
              disabled={save.isPending}
              onClick={() => save.mutate({ ...quiet, timezone: here })}
            >
              Use this device's time zone ({here})
            </button>
          )}
        </>
      )}
    </div>
  )
}

function HourSelect({ label, value, onChange }: { label: string; value: number; onChange: (hour: number) => void }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {HOURS.map((hour) => (
          <option key={hour} value={hour}>
            {hourLabel(hour)}
          </option>
        ))}
      </select>
    </div>
  )
}
