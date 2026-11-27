import { Hint } from '#/components/status/hint.tsx'
import { Progress, ProgressLabel } from '#/components/ui/progress.tsx'
import type { StatusTone } from '#/constants/worker-status.ts'
import { formatUsd } from '#/lib/money.ts'

const WARNING_SHARE = 0.7

const ALERT_SHARE = 0.9

const toneOfSpend = (share: number): StatusTone => {
  if (share >= ALERT_SHARE) {
    return 'failed'
  }

  return share >= WARNING_SHARE ? 'waiting' : 'running'
}

type SpendMeterProps = {
  spentUsd: number
  budgetUsd?: number
}

export const SpendMeter = ({ spentUsd, budgetUsd }: SpendMeterProps) => {
  if (budgetUsd === undefined) {
    return (
      <Hint label="What its model calls cost so far. This task has no budget.">
        <span className="tabular text-sm md:pt-1">
          {formatUsd(spentUsd)}
          <span className="text-muted-foreground"> no budget</span>
        </span>
      </Hint>
    )
  }

  return (
    <Hint
      label={`${formatUsd(spentUsd)} spent of a ${formatUsd(budgetUsd)} budget. The worker asks a person before it spends more.`}
    >
      <Progress
        value={Math.min(spentUsd, budgetUsd)}
        max={budgetUsd}
        data-status={toneOfSpend(spentUsd / budgetUsd)}
        aria-label="Spend against the budget"
        getAriaValueText={() => {
          return `${formatUsd(spentUsd)} of ${formatUsd(budgetUsd)}`
        }}
        className="cell-meter"
      >
        <ProgressLabel className="tabular text-sm font-normal">
          {formatUsd(spentUsd)}
          <span className="text-muted-foreground">
            {' '}
            of {formatUsd(budgetUsd)}
          </span>
        </ProgressLabel>
      </Progress>
    </Hint>
  )
}
