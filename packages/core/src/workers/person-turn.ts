import type { ChatMiddleware, InterruptDefinition } from '@tanstack/ai'
import type { TurnInfo, UserInput } from '@tanstack/ai-harness'
import {
  FILES_ANSWER,
  FINISH_WITHOUT_STOP_REFUSAL,
  SUCCESS_WITHOUT_WORDS_REFUSAL
} from '#/prompts/worker.ts'
import type { TaskEnd } from '#/session/metadata.ts'

const PERSON_INPUT = 'person:'

export function personInputId(inputId: string) {
  return `${PERSON_INPUT}${inputId}`
}

function wordsOf(message: UserInput | undefined) {
  if (typeof message === 'string') {
    return message
  }

  return message?.find((part) => {
    return part.type === 'text'
  })?.content
}

function answerWordsOf(response: unknown) {
  return typeof response === 'string' && response !== FILES_ANSWER
    ? response
    : undefined
}

type PersonTurn = { isPerson: boolean; words?: string }

export function createPersonTurn() {
  let turn: PersonTurn = { isPerson: false }

  const start = ({
    inputId,
    message
  }: Pick<TurnInfo, 'inputId' | 'message'>) => {
    const isPerson = inputId?.startsWith(PERSON_INPUT) === true
    turn = { isPerson, words: isPerson ? wordsOf(message) : undefined }
  }

  const answers: ChatMiddleware<
    unknown,
    InterruptDefinition<string, undefined, undefined>
  > = {
    name: 'workcell/worker-person-answers',
    onInterruptResolution: (_ctx, resolutions) => {
      if (!turn.isPerson) {
        return
      }

      const words = resolutions
        .all()
        .map((resolution) => {
          return resolution.status === 'resolved'
            ? answerWordsOf(resolution.response)
            : undefined
        })
        .find((answerWords) => {
          return answerWords !== undefined
        })
      turn = { ...turn, words }
    }
  }

  return {
    start,
    answers,
    finishRefusal: (outcome: TaskEnd['value']) => {
      if (!turn.isPerson) {
        return FINISH_WITHOUT_STOP_REFUSAL
      }

      return outcome === 'success' && turn.words === undefined
        ? SUCCESS_WITHOUT_WORDS_REFUSAL
        : undefined
    },
    withTheirWords: ({ value, cause }: TaskEnd): TaskEnd => {
      return { value, cause: value === 'success' ? turn.words : cause }
    }
  }
}
