import { MessageCircleQuestionIcon } from 'lucide-react'
import type { ToolCallPart } from '@tanstack/ai-harness/view'
import { ChatMarkdown } from '#/components/markdown/chat-markdown.tsx'
import { TraceIcon, TraceLine, TraceTitle } from '#/components/ui/trace.tsx'
import { askedQuestionsOf } from '#/lib/questions.ts'

type QuestionStepProps = {
  part: ToolCallPart
}

export const QuestionStep = ({ part }: QuestionStepProps) => {
  const questions = askedQuestionsOf(part.args, part.result)
  const isAnswered = part.status === 'done'

  return (
    <div className="flex flex-col gap-2">
      <TraceLine status={isAnswered ? undefined : 'pending'}>
        <TraceIcon>
          <MessageCircleQuestionIcon />
        </TraceIcon>
        <TraceTitle>
          {isAnswered ? 'Asked a person' : 'Asks a person'}
        </TraceTitle>
      </TraceLine>
      <ol className="flex flex-col gap-3 rounded-lg border p-3">
        {questions.map(({ question, options, answer }) => {
          return (
            <li key={question} className="flex flex-col gap-1.5">
              <p dir="auto" className="font-medium">
                {question}
              </p>
              {options.length === 0 ? null : (
                <p dir="auto" className="text-label text-muted-foreground">
                  {options.join(', ')}
                </p>
              )}
              {answer === undefined ? (
                <p data-status="waiting" className="text-sm text-status">
                  Waits for an answer in the chat.
                </p>
              ) : (
                <div dir="auto" data-status="success" className="text-status">
                  <ChatMarkdown text={answer} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
