import type React from 'react'
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

const SessionBody = ({ view, harness, threadId }: SessionBodyProps) => {
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

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <ConnectionStatus connection={connection} status={status} />
      </div>
      <WaitsForPeople approvals={approvals} questions={questions} />
      <div className="grid gap-6 lg:grid-cols-panel">
        <SessionChat messages={messages} isStreaming={status === 'running'} />
        <Tabs defaultValue="work" className="min-w-0">
          <TabsList>
            <TabsTrigger value="work">Work</TabsTrigger>
            <TabsTrigger value="files">
              Files
              {fileChanges.length === 0 ? null : (
                <span className="tabular text-muted-foreground">
                  {fileChanges.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="feedback">Feedback</TabsTrigger>
          </TabsList>
          <TabsContent value="work" className="flex flex-col gap-8 pt-4">
            <PlanStep state={todos} />
            <PanelSection title="Sandbox setup">
              <SetupSteps events={setupEvents} />
            </PanelSection>
            <PanelSection title="Background jobs">
              <BackgroundJobs jobs={jobs} />
            </PanelSection>
          </TabsContent>
          <TabsContent value="files" className="flex flex-col gap-8 pt-4">
            <PanelSection title="Changed in this visit">
              <ChangedFiles changes={fileChanges} />
            </PanelSection>
            {harness === 'worker' ? (
              <PanelSection title="Whole diff">
                <WholeDiff threadId={threadId} />
              </PanelSection>
            ) : null}
          </TabsContent>
          <TabsContent value="feedback" className="pt-4">
            <FeedbackList reports={feedback} showsThread={false} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

type SessionPanelProps = {
  harness: HarnessName
  threadId: string
  isThreadActive: boolean
  header: React.ReactNode
}

export const SessionPanel = ({
  harness,
  threadId,
  isThreadActive,
  header
}: SessionPanelProps) => {
  const view = useSessionView({ harness, threadId, isThreadActive })

  return (
    <div className="mx-auto flex w-full max-w-panel flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-3">{header}</header>
      {view === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : (
        <SessionBody view={view} harness={harness} threadId={threadId} />
      )}
    </div>
  )
}
