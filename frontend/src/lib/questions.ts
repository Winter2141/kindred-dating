import type { Question, QuestionCatalog } from './types'

export interface QuestionAnswer {
  answer: number
  acceptable: number[]
  importance: number
}

/** The first question (in catalog order) you haven't answered or skipped this time. */
export function nextUnanswered(catalog: QuestionCatalog, skipped: string[] = []): Question | undefined {
  return catalog.questions.find((q) => !catalog.answers[q.id] && !skipped.includes(q.id))
}
