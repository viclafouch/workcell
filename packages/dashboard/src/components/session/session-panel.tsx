import type React from 'react'
import { cn } from 'cn'
import type { SessionView } from '@tanstack/ai-harness/view'
import { useSelector } from '@tanstack/react-store'
import type { FeedbackPluginState } from '@workcell/core'
import { FeedbackList } from '#/components/feedback/feedback-list.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '#/components/ui/tabs.tsx'
import { useIsWideScreen } from '#/hooks/use-is-wide-screen.ts'
import { useSessionView } from '#/hooks/use-session-view.ts'
import { useWorkspaceActivity } from '#/hooks/use-workspace-activity.ts'
import { FEEDBACK_PLUGIN, TODOS_PLUGIN } from '#/lib/workspace-events.ts'
import type { HarnessName } from '#/server/dashboard-context.ts'
import { BackgroundJobs } from './background-jobs.tsx'
import { ChangedFiles } from './changed-files.tsx'
import { ConnectionStatus } from './connection-status.tsx'
import { PanelSection } from './panel-section.tsx'
import { PlanStep } from './plan-step.tsx'
import { SessionChat } from './session-chat.tsx'
import { SetupSteps } from './setup-steps.tsx'
import { WaitsForPeople } from './waits-for-people.tsx'
import { WholeDiff } from './whole-diff.tsx'

type SessionBodyProps = {
  view: SessionView
  harness: HarnessName
  threadId: string
  startedWorkers?: React.ReactNode
}

const EMPTY_FEEDBACK: FeedbackPluginState['reports'] = []

const matchIsFeedbackState = (value: unknown): value is FeedbackPluginState => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'reports' in value &&
    Array.isArray(value.reports)
  )
}

const PANE_CONTENT = 'min-h-0 flex-1 overflow-y-auto overscroll-contain pt-4'

const SessionBody = ({
  view,
  harness,
  threadId,
  startedWorkers
}: SessionBodyProps) => {
  const isWide = useIsWideScreen()
  const messages = useSelector(view.store, (state) => {
    return state.messages
  })
  const todos = useSelector(view.store, (state) => {
    return state.plugins[TODOS_PLUGIN]
  })
  const connection = useSelector(view.store, (state) => {
    return state.connection
  })
  const status = useSelector(view.store, (state) => {
    return state.status
  })
  const approvals = useSelector(view.store, (state) => {
    return state.approvals
  })
  const questions = useSelector(view.store, (state) => {
    return state.questions
  })
  const feedbackState = useSelector(view.store, (state) => {
    return state.plugins[FEEDBACK_PLUGIN]
  })
  const feedback = matchIsFeedbackState(feedbackState)
    ? feedbackState.reports.toReversed()
    : EMPTY_FEEDBACK
  const { fileChanges, jobs, setupEvents } = useWorkspaceActivity(view)
  const isWorker = harness === 'worker'
  const chat = (
    <SessionChat messages={messages} isStreaming={status === 'running'} />
  )
  const paneTabs = (
    <>
      {isWorker ? (
        <>
          <TabsTrigger value="work">Work</TabsTrigger>
          <TabsTrigger value="files">
            Files
            {fileChanges.length === 0 ? null : (
              <span className="tabular text-muted-foreground">
                {fileChanges.length}
              </span>
            )}
          </TabsTrigger>
        </>
      ) : (
        <TabsTrigger value="workers">Workers</TabsTrigger>
      )}
      <TabsTrigger value="feedback">Feedback</TabsTrigger>
    </>
  )
  const panes = (
    <>
      {isWorker ? (
        <>
          <TabsContent
            value="work"
            className={cn(PANE_CONTENT, 'flex flex-col gap-8')}
          >
            <PlanStep state={todos} />
            <PanelSection title="Sandbox setup">
              <SetupSteps events={setupEvents} />
            </PanelSection>
            <PanelSection title="Background jobs">
              <BackgroundJobs jobs={jobs} />
            </PanelSection>
          </TabsContent>
          <TabsContent
            value="files"
            className={cn(PANE_CONTENT, 'flex flex-col gap-8')}
          >
            <PanelSection title="Changed in this visit">
              <ChangedFiles changes={fileChanges} />
            </PanelSection>
            <PanelSection title="Whole diff">
              <WholeDiff threadId={threadId} />
            </PanelSection>
          </TabsContent>
        </>
      ) : (
        <TabsContent value="workers" className={PANE_CONTENT}>
          {startedWorkers}
        </TabsContent>
      )}
      <TabsContent value="feedback" className={PANE_CONTENT}>
        <FeedbackList reports={feedback} showsThread={false} />
      </TabsContent>
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ConnectionStatus connection={connection} status={status} />
      <WaitsForPeople approvals={approvals} questions={questions} />
      {isWide ? (
        <div className="grid min-h-0 flex-1 gap-6 grid-cols-panel">
          {chat}
          <Tabs
            defaultValue={isWorker ? 'work' : 'workers'}
            className="flex min-h-0 min-w-0 flex-col"
          >
            <TabsList>{paneTabs}</TabsList>
            {panes}
          </Tabs>
        </div>
      ) : (
        <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="chat">Chat</TabsTrigger>
            {paneTabs}
          </TabsList>
          <TabsContent value="chat" className="min-h-0 flex-1 pt-4">
            {chat}
          </TabsContent>
          {panes}
        </Tabs>
      )}
    </div>
  )
}

type SessionPanelProps = {
  harness: HarnessName
  threadId: string
  isThreadActive: boolean
  header: React.ReactNode
  startedWorkers?: React.ReactNode
}

export const SessionPanel = ({
  harness,
  threadId,
  isThreadActive,
  header,
  startedWorkers
}: SessionPanelProps) => {
  const view = useSessionView({ harness, threadId, isThreadActive })

  return (
    <div className="mx-auto flex h-panel w-full max-w-panel flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex shrink-0 flex-col gap-3">{header}</header>
      {view === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : (
        <SessionBody
          view={view}
          harness={harness}
          threadId={threadId}
          startedWorkers={startedWorkers}
        />
      )}
    </div>
  )
}
