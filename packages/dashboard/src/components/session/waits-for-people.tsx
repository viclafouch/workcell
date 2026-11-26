import { CircleHelpIcon, HandIcon } from 'lucide-react'
import type { SessionViewState } from '@tanstack/ai-harness/view'
import { Badge } from '#/components/ui/badge.tsx'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle
} from '#/components/ui/item.tsx'

type WaitsForPeopleProps = {
  approvals: SessionViewState['approvals']
  questions: SessionViewState['questions']
}

export const WaitsForPeople = ({
  approvals,
  questions
}: WaitsForPeopleProps) => {
  if (approvals.length === 0 && questions.length === 0) {
    return null
  }

  return (
    <ul aria-label="It waits for a person" className="flex flex-col gap-2">
      {approvals.map((approval) => {
        return (
          <Item
            render={<li />}
            key={approval.id}
            variant="outline"
            size="sm"
            data-status="waiting"
          >
            <ItemMedia variant="icon">
              <HandIcon aria-hidden />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                Run <code>{approval.tool}</code>?
              </ItemTitle>
              <ItemDescription>
                The worker waits for a yes or a no. Answer it in the chat.
              </ItemDescription>
            </ItemContent>
            <Badge
              variant="outline"
              data-status="waiting"
              className="status-pill"
            >
              Waits for you
            </Badge>
          </Item>
        )
      })}
      {questions.map((question) => {
        return (
          <Item
            render={<li />}
            key={question.id}
            variant="outline"
            size="sm"
            data-status="waiting"
          >
            <ItemMedia variant="icon">
              <CircleHelpIcon aria-hidden />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{question.message}</ItemTitle>
              <ItemDescription>Answer it in the chat.</ItemDescription>
            </ItemContent>
            <Badge
              variant="outline"
              data-status="waiting"
              className="status-pill"
            >
              Waits for you
            </Badge>
          </Item>
        )
      })}
    </ul>
  )
}
