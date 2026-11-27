import { z } from 'zod'

const questionArgsSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.object({ label: z.string() })).default([])
    })
  )
})

const ANSWER_BLOCK_SEPARATOR = '\n\n'

export type AskedQuestion = {
  question: string
  options: string[]
  answer: string | undefined
}

export const askedQuestionsOf = (args: unknown, result: unknown) => {
  const questions = questionArgsSchema.safeParse(args).data?.questions ?? []
  const answers =
    typeof result === 'string'
      ? result.split(ANSWER_BLOCK_SEPARATOR).map((block) => {
          return block.split('\n').at(-1)
        })
      : []

  return questions.map(({ question, options }, index): AskedQuestion => {
    return {
      question,
      options: options.map(({ label }) => {
        return label
      }),
      answer: answers[index]
    }
  })
}
