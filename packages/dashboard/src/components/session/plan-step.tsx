import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  RouteIcon
} from 'lucide-react'
import { z } from 'zod'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '#/components/ui/trace.tsx'

const todoStateSchema = z.object({
  items: z.array(
    z.object({
      text: z.string(),
      status: z.enum(['pending', 'in_progress', 'done'])
    })
  )
})

type TodoStatus = z.infer<typeof todoStateSchema>['items'][number]['status']

const STEP_ICONS = {
  pending: CircleIcon,
  in_progress: CircleDotIcon,
  done: CircleCheckIcon
} as const satisfies Record<TodoStatus, unknown>

const STEP_STATUS = {
  pending: 'pending',
  in_progress: 'running',
  done: undefined
} as const satisfies Record<TodoStatus, string | undefined>

type PlanStepProps = {
  state: unknown
}

export const PlanStep = ({ state }: PlanStepProps) => {
  const parsed = todoStateSchema.safeParse(state)
  const items = parsed.success ? parsed.data.items : []

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The worker writes its plan here once it has one.
      </p>
    )
  }

  const doneCount = items.filter(({ status }) => {
    return status === 'done'
  }).length
  const isRunning = items.some(({ status }) => {
    return status === 'in_progress'
  })

  return (
    <Trace>
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine status={isRunning ? 'running' : undefined}>
            <TraceIcon>
              <RouteIcon />
            </TraceIcon>
            <TraceTitle>Plan</TraceTitle>
            <TraceDescription>
              {doneCount} of {items.length} done
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            {items.map((item) => {
              const Icon = STEP_ICONS[item.status]

              return (
                <TraceLine key={item.text} status={STEP_STATUS[item.status]}>
                  <TraceIcon>
                    <Icon />
                  </TraceIcon>
                  <TraceTitle
                    dir="auto"
                    className="whitespace-normal wrap-anywhere"
                  >
                    {item.text}
                  </TraceTitle>
                </TraceLine>
              )
            })}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
