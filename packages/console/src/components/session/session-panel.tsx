import type React from 'react'
import { cn } from 'cn'
import type { SessionView } from '@tanstack/ai-harness/view'
import { useSelector } from '@tanstack/react-store'
import type { FeedbackPluginState } from '@workcell/core'
import { ChatPlaceHeader } from '#/components/chat/chat-place-header.tsx'
import { FeedbackList } from '#/components/feedback/feedback-list.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '#/components/ui/tabs.tsx'
import { useChatSpeakers } from '#/hooks/use-chat-speakers.ts'
import { useIsWideScreen } from '#/hooks/use-is-wide-screen.ts'
import { useSessionView } from '#/hooks/use-session-view.ts'
import { useWorkspaceActivity } from '#/hooks/use-workspace-activity.ts'
import { chatThreadOfMessages } from '#/lib/chat-input.ts'
import { pendingQuestionOf, withPendingQuestion } from '#/lib/live-turn.ts'
import { FEEDBACK_PLUGIN, TODOS_PLUGIN } from '#/lib/workspace-events.ts'
import type { HarnessName } from '#/server/console-context.ts'
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
  agentName?: string
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
  agentName,
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
  const isBotThread = harness === 'bot'
  const chatThreadId = isBotThread ? threadId : chatThreadOfMessages(messages)
  const speakers = useChatSpeakers({ harness, chatThreadId, agentName })
  const feedback = matchIsFeedbackState(feedbackState)
    ? feedbackState.reports.toReversed()
    : EMPTY_FEEDBACK
  const { fileChanges, jobs, setupEvents } = useWorkspaceActivity(view)
  const isWorker = harness === 'worker'
  const isStreaming = status === 'running'
  const shownMessages = withPendingQuestion(
    messages,
    isBotThread
      ? pendingQuestionOf({
          messages,
          details: speakers.details,
          isRunning: isStreaming
        })
      : null
  )
  const chat = (
    <SessionChat
      messages={shownMessages}
      isStreaming={isStreaming}
      speakers={speakers}
      header={
        speakers.chatMark === undefined || chatThreadId === null ? null : (
          <ChatPlaceHeader
            chatMark={speakers.chatMark}
            details={speakers.details}
          />
        )
      }
    />
  )
  const liveBadge = (
    <span className="ml-auto shrink-0">
      <ConnectionStatus connection={connection} status={status} />
    </span>
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
      <WaitsForPeople approvals={approvals} questions={questions} />
      {isWide ? (
        <div className="grid min-h-0 flex-1 gap-6 grid-cols-panel">
          {chat}
          <Tabs
            defaultValue={isWorker ? 'work' : 'workers'}
            className="flex min-h-0 min-w-0 flex-col"
          >
            <div className="flex items-center gap-3">
              <TabsList>{paneTabs}</TabsList>
              {liveBadge}
            </div>
            {panes}
          </Tabs>
        </div>
      ) : (
        <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-3">
            <TabsList className="max-w-full min-w-0 overflow-x-auto">
              <TabsTrigger value="chat">Chat</TabsTrigger>
              {paneTabs}
            </TabsList>
            {liveBadge}
          </div>
          <TabsContent value="chat" className="min-h-0 flex-1 pt-4">
            {chat}
          </TabsContent>
          {panes}
        </Tabs>
      )}
    </div>
  )
}

const SKELETON_TURNS = ['w-2/3', 'w-5/6', 'w-1/2'] as const

const SessionSkeleton = () => {
  return (
    <div
      aria-busy
      aria-label="Loading the transcript"
      className="appear-when-slow grid min-h-0 flex-1 gap-6 lg:grid-cols-panel"
    >
      <div className="flex flex-col gap-6 rounded-xl border bg-card p-4 sm:p-6">
        {SKELETON_TURNS.map((width) => {
          return (
            <div key={width} className="flex gap-3">
              <Skeleton className="size-8 shrink-0 rounded-md" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className={cn('h-4', width)} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="hidden flex-col gap-4 lg:flex">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  )
}

type SessionPanelProps = {
  harness: HarnessName
  threadId: string
  isThreadActive: boolean
  header: React.ReactNode
  agentName?: string
  startedWorkers?: React.ReactNode
}

export const SessionPanel = ({
  harness,
  threadId,
  isThreadActive,
  header,
  agentName,
  startedWorkers
}: SessionPanelProps) => {
  const view = useSessionView({ harness, threadId, isThreadActive })

  return (
    <div className="mx-auto flex h-panel w-full max-w-panel flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex shrink-0 flex-col gap-3">{header}</header>
      {view === null ? (
        <SessionSkeleton />
      ) : (
        <SessionBody
          view={view}
          harness={harness}
          threadId={threadId}
          agentName={agentName}
          startedWorkers={startedWorkers}
        />
      )}
    </div>
  )
}
