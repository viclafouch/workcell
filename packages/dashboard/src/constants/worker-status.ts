import type { WorkerView } from '@workcell/core'

export type StatusTone = 'running' | 'waiting' | 'success' | 'failed' | 'idle'

type Outcome = NonNullable<WorkerView['outcome']>['value']

type Phase = WorkerView['phase']

export type WorkerStatus = {
  tone: StatusTone
  label: string
  hint: string
}

const PHASE_STATUSES = {
  setup: {
    tone: 'running',
    label: 'Setting up',
    hint: 'Its sandbox starts: the repository is cloned and its tools are installed.'
  },
  queued: {
    tone: 'idle',
    label: 'Queued',
    hint: 'It waits for a free slot: the host runs a few turns at once.'
  },
  model: {
    tone: 'running',
    label: 'Thinking',
    hint: 'The model writes its next step.'
  },
  tool: {
    tone: 'running',
    label: 'Running',
    hint: 'It runs a command or edits a file in its sandbox.'
  },
  waiting: {
    tone: 'waiting',
    label: 'Waits for you',
    hint: 'It stopped to ask a person. Answer it in the chat.'
  },
  idle: {
    tone: 'idle',
    label: 'Asleep',
    hint: 'No turn runs. It costs nothing, and wakes up on the next message or event.'
  },
  finished: {
    tone: 'idle',
    label: 'Finished',
    hint: 'Its task ended.'
  }
} as const satisfies Record<Phase, WorkerStatus>

const OUTCOME_STATUSES = {
  success: {
    tone: 'success',
    label: 'Merged',
    hint: 'A person merged its pull request as it was.'
  },
  flawed: {
    tone: 'success',
    label: 'Merged after changes',
    hint: 'A person asked for changes before merging its pull request.'
  },
  blocked: {
    tone: 'failed',
    label: 'Blocked',
    hint: 'It stopped and named why.'
  },
  manual: {
    tone: 'idle',
    label: 'Taken over',
    hint: 'A person finished the task by hand.'
  }
} as const satisfies Record<Outcome, WorkerStatus>

export const LIFECYCLE_STAGES = [
  'Sandbox',
  'Work',
  'Pull request',
  'Done'
] as const

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number]

export const STAGE_HINTS = {
  Sandbox: 'Its sandbox gets ready.',
  Work: 'It works on the task, before any pull request.',
  'Pull request': 'Its pull request is open and waits for checks and a review.',
  Done: 'The task ended.'
} as const satisfies Record<LifecycleStage, string>

export const statusOfWorker = ({
  phase,
  outcome
}: WorkerView): WorkerStatus => {
  if (outcome === undefined) {
    return PHASE_STATUSES[phase]
  }

  const status = OUTCOME_STATUSES[outcome.value]

  return outcome.cause === undefined
    ? status
    : { ...status, hint: outcome.cause }
}

export const stageOfWorker = ({
  phase,
  pullRequest
}: WorkerView): LifecycleStage => {
  if (phase === 'finished') {
    return 'Done'
  }

  if (phase === 'setup' || phase === 'queued') {
    return 'Sandbox'
  }

  return pullRequest === undefined ? 'Work' : 'Pull request'
}

export const matchIsLiveTone = (tone: StatusTone) => {
  return tone === 'running'
}
