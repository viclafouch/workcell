import type React from 'react'
import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleXIcon,
  type LucideIcon
} from 'lucide-react'
import type { Signal } from '#/constants/pull-request-status.ts'

const SIGNAL_ICONS = {
  success: CircleCheckIcon,
  danger: CircleXIcon,
  attention: CircleDotIcon,
  done: CircleCheckIcon,
  neutral: CircleDotIcon
} as const satisfies Record<Signal, LucideIcon>

type SignalLineProps = {
  signal: Signal
  children: React.ReactNode
}

export const SignalLine = ({ signal, children }: SignalLineProps) => {
  const Icon = SIGNAL_ICONS[signal]

  return (
    <span
      data-signal={signal}
      className="inline-flex min-w-0 items-start gap-1.5 text-sm text-signal"
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}
