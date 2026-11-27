import { describe, expect, it } from 'vitest'
import { askedQuestionsOf } from '#/lib/questions.ts'

const ARGS = {
  questions: [
    {
      question: 'Which package?',
      options: [{ label: 'hooks' }, { label: 'helpers' }]
    },
    { question: 'Push it?', options: [{ label: 'Yes' }, { label: 'No' }] }
  ]
}

describe('a question a worker asked a person', () => {
  it('pairs each question with the answer it got', () => {
    expect(
      askedQuestionsOf(
        ARGS,
        'Which package?\nOwn answer: design-system\n\nPush it?\nAnswer: No'
      )
    ).toStrictEqual([
      {
        question: 'Which package?',
        options: ['hooks', 'helpers'],
        answer: 'Own answer: design-system'
      },
      { question: 'Push it?', options: ['Yes', 'No'], answer: 'Answer: No' }
    ])
  })

  it('shows a question with no answer while it waits', () => {
    expect(askedQuestionsOf(ARGS, null)[0]?.answer).toBeUndefined()
  })
})
