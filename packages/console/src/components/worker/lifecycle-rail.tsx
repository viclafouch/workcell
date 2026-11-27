import { Hint } from '#/components/status/hint.tsx'
import { Progress, ProgressLabel } from '#/components/ui/progress.tsx'
import {
  LIFECYCLE_STAGES,
  STAGE_HINTS,
  type LifecycleStage,
  type StatusTone
} from '#/constants/worker-status.ts'

type LifecycleRailProps = {
  stage: LifecycleStage
  tone: StatusTone
}

export const LifecycleRail = ({ stage, tone }: LifecycleRailProps) => {
  const position = LIFECYCLE_STAGES.indexOf(stage) + 1

  return (
    <Hint
      label={`${STAGE_HINTS[stage]} The stages are ${LIFECYCLE_STAGES.join(', then ')}.`}
    >
      <Progress
        value={position}
        max={LIFECYCLE_STAGES.length}
        data-status={tone}
        getAriaValueText={() => {
          return `${stage}, stage ${position} of ${LIFECYCLE_STAGES.length}`
        }}
        className="cell-meter"
      >
        <ProgressLabel className="text-sm font-normal">
          {stage}
          <span className="tabular text-muted-foreground">
            {' '}
            {position} of {LIFECYCLE_STAGES.length}
          </span>
        </ProgressLabel>
      </Progress>
    </Hint>
  )
}
