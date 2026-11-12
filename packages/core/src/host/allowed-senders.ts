import type { AcceptInput, HarnessUser } from '@tanstack/ai-harness'

export const SENDER_REFUSAL = 'sender_not_allowed'

export type AcceptAllowedSendersParams = {
  starterIds: readonly string[]
  isColleagueThread: (threadId: string) => boolean
}

export function isStarterIn(starterIds: readonly string[]) {
  return (user: HarnessUser | undefined): user is HarnessUser => {
    return user !== undefined && starterIds.includes(user.id)
  }
}

export type IsStarter = ReturnType<typeof isStarterIn>

export function acceptAllowedSenders({
  starterIds,
  isColleagueThread
}: AcceptAllowedSendersParams): AcceptInput {
  const isStarter = isStarterIn(starterIds)

  return (input, { user, threadId }) => {
    return isStarter(user) || isColleagueThread(threadId)
      ? input
      : { refuse: SENDER_REFUSAL }
  }
}

export function refusalOf(starter: HarnessUser) {
  return new Error(`${starter.id} may not start or steer a worker.`)
}
