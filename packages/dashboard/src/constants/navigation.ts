import {
  ActivityIcon,
  ChartLineIcon,
  FlaskConicalIcon,
  MessageSquareWarningIcon,
  type LucideIcon
} from 'lucide-react'

export type NavigationItem = {
  to: '/' | '/feedback'
  label: string
  icon: LucideIcon
}

export type UpcomingItem = {
  label: string
  icon: LucideIcon
}

export const OVERVIEW_ITEMS = [
  { to: '/', label: 'Now', icon: ActivityIcon },
  { to: '/feedback', label: 'Feedback', icon: MessageSquareWarningIcon }
] as const satisfies readonly NavigationItem[]

export const UPCOMING_ITEMS = [
  { label: 'History and cost', icon: ChartLineIcon },
  { label: 'Eval set', icon: FlaskConicalIcon }
] as const satisfies readonly UpcomingItem[]

export const SIDEBAR_STATE_COOKIE = 'sidebar_state'

export const BOT_THREADS_IN_SIDEBAR = 5
