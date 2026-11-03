import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, ChevronRight, HeartHandshake, ListChecks, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/lib/api'
import { keys } from '@/lib/cache'
import { nextUnanswered, type QuestionAnswer } from '@/lib/questions'
import type { Question, QuestionCatalog } from '@/lib/types'
import { useToasts } from '@/store/live'
import { Segmented } from './ProfileFields'
import { Dialog, Spinner } from './ui'

export function useQuestions() {
  return useQuery({ queryKey: keys.questions, queryFn: api.questions, staleTime: 60_000 })
}

/** On the Profile page: how many questions you've answered, and a way to answer more. */
export function QuestionsCard() {
  const questions = useQuestions()
  const [open, setOpen] = useState<'answer' | 'review' | null>(null)
  if (!questions.data) return null
  const total = questions.data.questions.length
  const answered = Object.keys(questions.data.answers).length
  const done = answered === total

  return (
    <div className="card mt-6 p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-coral/12 text-coral">
          <HeartHandshake className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl leading-tight">Compatibility questions</h2>
          <p className="mt-1 text-sm text-muted">
            {answered < questions.data.min_common
              ? `Answer at least ${questions.data.min_common} to see how you line up with people.`
              : 'Your answers stay private. Matches only see the ones you have in common.'}
          </p>
        </div>
      </div>
      <div className="mt-5">
        <div className="flex justify-between text-xs font-semibold text-muted">
          <span>
            {answered} of {total} answered
          </span>
          <span>{Math.round((answered / total) * 100)}%</span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-raised"
          role="progressbar"
          aria-label="Questions answered"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answered}
        >
          <div className="h-full rounded-full bg-gradient-brand transition-all" style={{ width: `${(answered / total) * 100}%` }} />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {!done && (
          <button type="button" className="btn-primary" onClick={() => setOpen('answer')}>
            <Sparkles className="size-4" /> {answered ? 'Answer more' : 'Start answering'}
          </button>
        )}
        {answered > 0 && (
          <button type="button" className="btn-secondary" onClick={() => setOpen('review')}>
            <ListChecks className="size-4" /> Review answers
          </button>
        )}
      </div>
      <QuestionsDialog catalog={questions.data} mode={open} onClose={() => setOpen(null)} />
    </div>
  )
}

function QuestionsDialog({
  catalog,
  mode,
  onClose,
}: {
  catalog: QuestionCatalog
  mode: 'answer' | 'review' | null
  onClose: () => void
}) {
  // In review mode you pick a question from the list; in answer mode we walk the unanswered ones.
  const [editing, setEditing] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const close = () => {
    setEditing(null)
    setSkipped([])
    onClose()
  }

  const current =
    editing ?? (mode === 'answer' ? nextUnanswered(catalog, skipped)?.id ?? null : null)
  const question = catalog.questions.find((q) => q.id === current)

  return (
    <Dialog open={mode !== null} onClose={close} title={question ? question.topic : 'Your answers'} wide>
      {question ? (
        <QuestionForm
          key={question.id}
          question={question}
          saved={catalog.answers[question.id]}
          importanceLabels={catalog.importance_labels}
          onSaved={() => setEditing(null)}
          onSkip={() => {
            if (editing) setEditing(null)
            else setSkipped((list) => [...list, question.id])
          }}
          skipLabel={editing ? 'Back' : 'Skip'}
        />
      ) : mode === 'answer' ? (
        <div className="py-6 text-center">
          <p className="font-display text-3xl">That's everything for now</p>
          <p className="mt-2 text-sm text-muted">Change an answer any time from Review answers.</p>
          <button type="button" className="btn-primary mt-6" onClick={close}>
            Done
          </button>
        </div>
      ) : (
        <AnswerList catalog={catalog} onEdit={setEditing} />
      )}
    </Dialog>
  )
}

function QuestionForm({
  question,
  saved,
  importanceLabels,
  onSaved,
  onSkip,
  skipLabel,
}: {
  question: Question
  saved: QuestionAnswer | undefined
  importanceLabels: string[]
  onSaved: () => void
  onSkip: () => void
  skipLabel: string
}) {
  const queryClient = useQueryClient()
  const everyone = question.options.map((_, i) => i)
  const [answer, setAnswer] = useState<number | null>(saved?.answer ?? null)
  const [acceptable, setAcceptable] = useState<number[]>(saved?.acceptable ?? everyone)
  const [importance, setImportance] = useState(saved?.importance ?? 1)

  const save = useMutation({
    mutationFn: () => api.answerQuestion(question.id, { answer: answer!, acceptable, importance }),
    onSuccess: (stored) => {
      queryClient.setQueryData<QuestionCatalog>(keys.questions, (catalog) =>
        catalog ? { ...catalog, answers: { ...catalog.answers, [question.id]: stored } } : catalog,
      )
      void queryClient.invalidateQueries({ queryKey: keys.discover })
      onSaved()
    },
    onError: (error) => useToasts.getState().push({ title: "Couldn't save that answer", body: error.message }),
  })

  const toggleAcceptable = (index: number) =>
    setAcceptable((list) =>
      list.includes(index) ? (list.length > 1 ? list.filter((i) => i !== index) : list) : [...list, index].sort(),
    )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (answer !== null) save.mutate()
      }}
      className="space-y-7"
    >
      <p className="font-display text-[2rem] leading-tight">{question.text}</p>

      <fieldset>
        <legend className="label">Your answer</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {question.options.map((option, index) => (
            <label
              key={option}
              className={clsx(
                'flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3.5 text-sm font-semibold transition',
                answer === index
                  ? 'border-coral/60 bg-coral/15 text-apricot'
                  : 'border-line bg-raised/60 text-cream hover:border-line-strong',
              )}
            >
              <input
                type="radio"
                name={`answer-${question.id}`}
                className="sr-only"
                checked={answer === index}
                onChange={() => setAnswer(index)}
              />
              <span
                className={clsx(
                  'grid size-5 shrink-0 place-items-center rounded-full border-2',
                  answer === index ? 'border-coral bg-coral text-ink' : 'border-line-strong',
                )}
                aria-hidden
              >
                {answer === index && <Check className="size-3" strokeWidth={3} />}
              </span>
              {option}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Answers you'd accept from a match</legend>
        <div className="flex flex-wrap gap-2">
          {question.options.map((option, index) => (
            <button
              key={option}
              type="button"
              aria-pressed={acceptable.includes(index)}
              onClick={() => toggleAcceptable(index)}
              className={clsx(
                'rounded-full border px-4 py-2 text-sm font-semibold transition',
                acceptable.includes(index)
                  ? 'border-mint/50 bg-mint/10 text-mint'
                  : 'border-line bg-raised/60 text-faint line-through hover:text-muted',
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <span className="label">How much does this matter to you?</span>
        <Segmented
          label="How much does this matter to you?"
          value={[String(importance)]}
          onChange={([value]) => setImportance(Number(value))}
          options={importanceLabels.map((label, i) => ({ value: String(i), label }))}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        <button type="button" className="btn-ghost" onClick={onSkip}>
          {skipLabel}
        </button>
        <button type="submit" className="btn-primary" disabled={answer === null || save.isPending}>
          {save.isPending ? <Spinner className="size-4" /> : <Check className="size-4" />} Save
        </button>
      </div>
    </form>
  )
}

function AnswerList({ catalog, onEdit }: { catalog: QuestionCatalog; onEdit: (id: string) => void }) {
  const answered = catalog.questions.filter((q) => catalog.answers[q.id])
  return (
    <ul className="divide-y divide-line">
      {answered.map((question) => {
        const saved = catalog.answers[question.id]
        return (
          <li key={question.id}>
            <button
              type="button"
              onClick={() => onEdit(question.id)}
              className="flex w-full items-center gap-4 py-3.5 text-left transition hover:text-apricot"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-muted">{question.text}</span>
                <span className="mt-0.5 block font-semibold">
                  {question.options[saved.answer]}
                  <span className="ml-2 text-xs font-normal text-faint">
                    · matters {catalog.importance_labels[saved.importance].toLowerCase()}
                  </span>
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-faint" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** In someone's profile: your agreement and the questions you answered alike. */
export function AgreementPanel({ userId }: { userId: number }) {
  const agreement = useQuery({
    queryKey: keys.agreement(userId),
    queryFn: () => api.agreement(userId),
    staleTime: 60_000,
  })
  if (!agreement.data || (agreement.data.percent === null && agreement.data.same.length === 0)) return null
  const { percent, same } = agreement.data
  return (
    <div className="rounded-3xl border border-line bg-raised/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-muted uppercase">
          <HeartHandshake className="size-3.5 text-coral" /> Your answers
        </p>
        {percent !== null && <span className="text-sm font-bold text-apricot">{percent}% agree</span>}
      </div>
      {same.length > 0 && (
        <ul className="mt-3 space-y-2">
          {same.slice(0, 4).map((item) => (
            <li key={item.question} className="text-sm">
              <span className="text-muted">{item.question}</span>{' '}
              <span className="font-semibold text-cream">You both said {item.answer.toLowerCase()}.</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
