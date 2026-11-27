import {
  CircleCheckIcon,
  DownloadIcon,
  HardDriveIcon,
  LinkIcon,
  PackageIcon,
  RotateCcwIcon,
  type LucideIcon
} from 'lucide-react'
import type { WorkerSandboxSetupEvent } from '@workcell/core'
import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '#/components/ui/trace.tsx'

type SetupStep = Exclude<WorkerSandboxSetupEvent['step'], 'done'>

const SETUP_STEPS = {
  create: {
    icon: HardDriveIcon,
    done: 'Created its sandbox',
    running: 'Creating its sandbox'
  },
  clone: {
    icon: DownloadIcon,
    done: 'Cloned the repository',
    running: 'Cloning the repository'
  },
  setup: {
    icon: PackageIcon,
    done: 'Installed its tools',
    running: 'Installing its tools'
  },
  restore: {
    icon: RotateCcwIcon,
    done: 'Restored its changes',
    running: 'Restoring its changes'
  },
  bind: {
    icon: LinkIcon,
    done: 'Bound the workspace',
    running: 'Binding the workspace'
  }
} as const satisfies Record<
  SetupStep,
  { icon: LucideIcon; done: string; running: string }
>

type SetupStepsProps = {
  events: readonly WorkerSandboxSetupEvent[]
}

export const SetupSteps = ({ events }: SetupStepsProps) => {
  const steps = events.flatMap((event) => {
    return event.step === 'done' ? [] : [event]
  })
  const isDone = events.at(-1)?.step === 'done'

  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Setup steps show here when the worker starts a sandbox during this
        visit.
      </p>
    )
  }

  return (
    <Trace>
      {steps.map((event, index) => {
        const step = SETUP_STEPS[event.step]
        const isCurrent = index === steps.length - 1 && !isDone
        const { icon: Icon } = step

        return (
          // oxlint-disable-next-line react/no-array-index-key -- a setup step can repeat, so its position is its identity
          <TraceLine key={index} status={isCurrent ? 'running' : undefined}>
            <TraceIcon>{isCurrent ? <Icon /> : <CircleCheckIcon />}</TraceIcon>
            <TraceTitle>{isCurrent ? step.running : step.done}</TraceTitle>
            {'commands' in event && event.commands !== undefined ? (
              <TraceDescription className="font-mono">
                {event.commands.join(' && ')}
              </TraceDescription>
            ) : null}
          </TraceLine>
        )
      })}
    </Trace>
  )
}
