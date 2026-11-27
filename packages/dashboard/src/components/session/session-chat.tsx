import React from 'react'
import { CheckIcon, CopyIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import type { ViewMessage } from '@tanstack/ai-harness/view'
import { ChatMarkdown } from '#/components/markdown/chat-markdown.tsx'
import { Alert, AlertDescription } from '#/components/ui/alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '#/components/ui/message-scroller.tsx'
import type { ChatSpeaker, ChatSpeakers } from '#/hooks/use-chat-speakers.ts'
import { useNow } from '#/hooks/use-now.ts'
import {
  groupChatTurns,
  lastActivityOf,
  splitAgentWork,
  type ChatTurn
} from '#/lib/chat-turns.ts'
import { formatDateTime, formatMessageTime } from '#/lib/dates.ts'
import { matchIsLiveMessage } from '#/lib/live-turn.ts'
import { AssistantParts } from './assistant-parts.tsx'
import { SpeakerAvatar } from './speaker-avatar.tsx'
import { WorkGroup } from './work-group.tsx'

const COPIED_FEEDBACK_MS = 1500

type CopyMessageButtonProps = {
  text: string
}

const CopyMessageButton = ({ text }: CopyMessageButtonProps) => {
  const [hasCopied, setHasCopied] = React.useState(false)

  React.useEffect(() => {
    if (!hasCopied) {
      return
    }

    const timeout = setTimeout(() => {
      setHasCopied(false)
    }, COPIED_FEEDBACK_MS)

    return () => {
      clearTimeout(timeout)
    }
  }, [hasCopied])

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setHasCopied(true)
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={hasCopied ? 'Copied' : 'Copy the message'}
      className="opacity-0 transition-opacity group-focus-within/turn:opacity-100 group-hover/turn:opacity-100 pointer-coarse:opacity-100"
      onClick={() => {
        void copy()
      }}
    >
      {hasCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
    </Button>
  )
}

type MessageTimeProps = {
  value: number | undefined
}

const MessageTime = ({ value }: MessageTimeProps) => {
  const now = useNow()

  if (value === undefined) {
    return null
  }

  return (
    <time
      dateTime={new Date(value).toISOString()}
      title={formatDateTime(value)}
      className="text-xs text-muted-foreground tabular"
    >
      {formatMessageTime(value, now)}
    </time>
  )
}

type TurnRowProps = {
  speaker: ChatSpeaker
  time: number | undefined
  copyText: string
  children: React.ReactNode
}

const TurnRow = ({ speaker, time, copyText, children }: TurnRowProps) => {
  return (
    <article className="group/turn flex gap-3">
      <SpeakerAvatar
        avatarUrl={speaker.avatarUrl}
        fallback={speaker.fallback}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <header className="flex min-h-6 items-center gap-2">
          {speaker.name === undefined ? null : (
            <span dir="auto" className="truncate text-sm font-semibold">
              {speaker.name}
            </span>
          )}
          <MessageTime value={time} />
          {copyText === '' ? null : (
            <span className="ml-auto">
              <CopyMessageButton text={copyText} />
            </span>
          )}
        </header>
        {children}
      </div>
    </article>
  )
}

const textOfParts = (parts: readonly { type: string; text?: string }[]) => {
  return parts
    .flatMap((part) => {
      return part.type === 'text' && part.text !== undefined ? [part.text] : []
    })
    .join('\n\n')
}

type TurnViewProps = {
  turn: ChatTurn
  previousTurn: ChatTurn | undefined
  isStreaming: boolean
  speakers: ChatSpeakers
}

const TurnView = ({
  turn,
  previousTurn,
  isStreaming,
  speakers
}: TurnViewProps) => {
  if (turn.kind === 'person') {
    const person = speakers.personOf(turn.message)

    return (
      <TurnRow
        speaker={person}
        time={person.sentAt}
        copyText={turn.message.text}
      >
        <div dir="auto">
          <ChatMarkdown text={turn.message.text} />
        </div>
      </TurnRow>
    )
  }

  if (turn.kind === 'notice') {
    const isError = turn.message.kind === 'error'

    return (
      <Alert variant={isError ? 'destructive' : 'default'}>
        {isError ? <TriangleAlertIcon aria-hidden /> : <InfoIcon aria-hidden />}
        <AlertDescription>{turn.message.text}</AlertDescription>
      </Alert>
    )
  }

  const { work, answer } = splitAgentWork(turn.messages)
  const startedAt =
    previousTurn?.kind === 'person'
      ? (previousTurn.message.createdAt ??
        speakers.personOf(previousTurn.message).sentAt)
      : turn.messages[0]?.createdAt
  const endedAt = lastActivityOf(turn.messages)

  return (
    <TurnRow
      speaker={speakers.agent}
      time={turn.messages[0]?.createdAt}
      copyText={textOfParts(answer)}
    >
      {work.length === 0 ? null : (
        <WorkGroup
          parts={work}
          isWorking={isStreaming}
          isLastPartStreaming={isStreaming && answer.length === 0}
          durationMs={
            startedAt === undefined || endedAt === undefined || isStreaming
              ? undefined
              : endedAt - startedAt
          }
        />
      )}
      {answer.length === 0 ? null : (
        <AssistantParts parts={answer} isStreaming={isStreaming} />
      )}
    </TurnRow>
  )
}

type SessionChatProps = {
  messages: readonly ViewMessage[]
  isStreaming: boolean
  speakers: ChatSpeakers
  header?: React.ReactNode
}

export const SessionChat = ({
  messages,
  isStreaming,
  speakers,
  header
}: SessionChatProps) => {
  const turns = groupChatTurns(messages)

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="h-full min-h-0 rounded-xl border bg-card">
        {header}
        <MessageScrollerViewport className="rounded-b-xl focus-visible:[outline-offset:calc(var(--focus-width)*-1)]">
          <MessageScrollerContent
            aria-label="Transcript"
            aria-busy={isStreaming}
            className="gap-6 p-4 sm:p-6"
          >
            {turns.map((turn, index) => {
              return (
                <MessageScrollerItem
                  key={turn.id}
                  messageId={turn.id}
                  scrollAnchor={turn.kind === 'person'}
                  className="-mx-1 p-1"
                >
                  <TurnView
                    turn={turn}
                    previousTurn={turns[index - 1]}
                    isStreaming={
                      isStreaming &&
                      index === turns.length - 1 &&
                      turn.kind === 'agent' &&
                      turn.messages.some(matchIsLiveMessage)
                    }
                    speakers={speakers}
                  />
                </MessageScrollerItem>
              )
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
