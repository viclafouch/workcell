import { ListTreeIcon } from 'lucide-react'
import type { ViewPart } from '@tanstack/ai-harness/view'
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '#/components/ui/trace.tsx'
import { formatDuration } from '#/lib/dates.ts'
import { AssistantParts } from './assistant-parts.tsx'

const stepsLabel = new Intl.PluralRules('en')

const countOfSteps = (count: number) => {
  return `${count} ${stepsLabel.select(count) === 'one' ? 'step' : 'steps'}`
}

type TitleParams = {
  isWorking: boolean
  durationMs: number | undefined
}

const titleOf = ({ isWorking, durationMs }: TitleParams) => {
  if (isWorking) {
    return 'Working'
  }

  return durationMs === undefined
    ? 'Worked'
    : `Worked for ${formatDuration(durationMs)}`
}

type WorkGroupProps = {
  parts: readonly ViewPart[]
  isWorking: boolean
  isLastPartStreaming: boolean
  durationMs?: number
}

export const WorkGroup = ({
  parts,
  isWorking,
  isLastPartStreaming,
  durationMs
}: WorkGroupProps) => {
  const title = titleOf({ isWorking, durationMs })

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={isWorking ? 'running' : undefined}>
          <TraceIcon>
            <ListTreeIcon />
          </TraceIcon>
          <TraceTitle>{title}</TraceTitle>
          <TraceDescription>{countOfSteps(parts.length)}</TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-3">
        <AssistantParts parts={parts} isStreaming={isLastPartStreaming} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}
