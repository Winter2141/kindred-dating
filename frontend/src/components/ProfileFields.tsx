import clsx from 'clsx'
import { Plus, Trash2 } from 'lucide-react'
import type { Gender, Prompt } from '@/lib/types'
import { useMeta } from './ui'

export const GENDER_LABELS: Record<Gender, string> = {
  woman: 'Women',
  man: 'Men',
  nonbinary: 'Non-binary people',
}
export const GENDER_SELF: Record<Gender, string> = {
  woman: 'Woman',
  man: 'Man',
  nonbinary: 'Non-binary',
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  multiple = false,
  label,
}: {
  options: { value: T; label: string }[]
  value: T[]
  onChange: (value: T[]) => void
  multiple?: boolean
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = value.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (!multiple) return onChange([option.value])
              const next = active ? value.filter((v) => v !== option.value) : [...value, option.value]
              if (next.length) onChange(next)
            }}
            className={clsx(
              'rounded-full border px-4 py-2.5 text-sm font-semibold transition',
              active
                ? 'border-coral/60 bg-coral/15 text-apricot'
                : 'border-line bg-raised/60 text-muted hover:border-line-strong hover:text-cream',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function InterestPicker({
  value,
  onChange,
}: {
  value: string[]
  onChange: (value: string[]) => void
}) {
  const { data: meta } = useMeta()
  const max = meta?.max_interests ?? 8
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="label mb-0">Interests</span>
        <span className={clsx('text-xs', value.length >= max ? 'text-apricot' : 'text-faint')}>
          {value.length}/{max}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {meta?.interests.map(({ name, emoji }) => {
          const active = value.includes(name)
          const disabled = !active && value.length >= max
          return (
            <button
              key={name}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(active ? value.filter((v) => v !== name) : [...value, name])}
              className={clsx(
                'chip transition',
                active
                  ? 'chip-shared'
                  : 'text-muted hover:border-line-strong hover:text-cream disabled:opacity-35',
              )}
            >
              <span aria-hidden>{emoji}</span>
              {name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function PromptEditor({
  value,
  onChange,
}: {
  value: Prompt[]
  onChange: (value: Prompt[]) => void
}) {
  const { data: meta } = useMeta()
  const max = meta?.max_prompts ?? 3
  const questions = meta?.prompt_questions ?? []
  const unused = questions.filter((q) => !value.some((p) => p.question === q))

  const update = (index: number, patch: Partial<Prompt>) =>
    onChange(value.map((p, i) => (i === index ? { ...p, ...patch } : p)))

  return (
    <div className="space-y-3">
      <span className="label">Prompts</span>
      {value.map((prompt, index) => (
        <div key={index} className="rounded-3xl border border-line bg-raised/50 p-4">
          <div className="flex items-center gap-2">
            <select
              value={prompt.question}
              onChange={(e) => update(index, { question: e.target.value })}
              className="min-w-0 flex-1 cursor-pointer bg-transparent text-sm font-semibold text-apricot outline-none"
              aria-label="Prompt question"
            >
              {[prompt.question, ...unused].map((q) => (
                <option key={q} value={q} className="bg-surface text-cream">
                  {q}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              className="grid size-8 place-items-center rounded-full text-faint transition hover:bg-raised hover:text-rose"
              aria-label="Remove prompt"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <textarea
            value={prompt.answer}
            maxLength={200}
            rows={2}
            onChange={(e) => update(index, { answer: e.target.value })}
            placeholder="Your answer…"
            className="mt-2 w-full resize-none bg-transparent font-display text-xl leading-snug text-cream outline-none placeholder:text-faint"
          />
        </div>
      ))}
      {value.length < max && unused.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...value, { question: unused[0], answer: '' }])}
          className="flex w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-line-strong py-4 text-sm font-semibold text-muted transition hover:border-coral/50 hover:text-cream"
        >
          <Plus className="size-4" /> Add a prompt
        </button>
      )}
    </div>
  )
}

export function AgeRange({
  min,
  max,
  onChange,
}: {
  min: number
  max: number
  onChange: (min: number, max: number) => void
}) {
  const clamp = (n: number) => Math.max(18, Math.min(99, Number.isFinite(n) ? n : 18))
  return (
    <div>
      <span className="label">Age range</span>
      <div className="flex items-center gap-3">
        <input
          type="number"
          inputMode="numeric"
          min={18}
          max={max}
          value={min}
          onChange={(e) => onChange(Math.min(clamp(e.target.valueAsNumber), max), max)}
          className="field w-24 text-center"
          aria-label="Minimum age"
        />
        <span className="h-px flex-1 bg-gradient-brand opacity-60" />
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={99}
          value={max}
          onChange={(e) => onChange(min, Math.max(clamp(e.target.valueAsNumber), min))}
          className="field w-24 text-center"
          aria-label="Maximum age"
        />
      </div>
    </div>
  )
}
