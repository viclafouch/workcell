import { BotIcon, BrainIcon, CircleAlertIcon, FileIcon } from 'lucide-react'
import type { MediaPart, ViewPart } from '@tanstack/ai-harness/view'
import { ChatMarkdown } from '#/components/markdown/chat-markdown.tsx'
import {
  Attachment,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle
} from '#/components/ui/attachment.tsx'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '#/components/ui/trace.tsx'
import { ToolStep } from './tool-step.tsx'

type ReasoningStepProps = {
  text: string
  isStreaming: boolean
}

const ReasoningStep = ({ text, isStreaming }: ReasoningStepProps) => {
  const line = (
    <TraceLine status={isStreaming ? 'running' : undefined}>
      <TraceIcon>
        <BrainIcon />
      </TraceIcon>
      <TraceTitle>{isStreaming ? 'Thinking' : 'Thought'}</TraceTitle>
    </TraceLine>
  )

  if (text.trim() === '') {
    return line
  }

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <ChatMarkdown text={text} isStreaming={isStreaming} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

type MediaAttachmentProps = {
  part: MediaPart
}

const MediaAttachment = ({ part }: MediaAttachmentProps) => {
  return (
    <Attachment size="sm">
      <AttachmentMedia
        variant={
          part.kind === 'image' && part.url !== undefined ? 'image' : 'icon'
        }
      >
        {part.kind === 'image' && part.url !== undefined ? (
          <img src={part.url} alt="" />
        ) : (
          <FileIcon aria-hidden />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>
          {part.url === undefined ? (
            part.name
          ) : (
            <a
              href={part.url}
              download={part.name}
              className="underline-offset-4 hover:underline"
            >
              {part.name}
            </a>
          )}
        </AttachmentTitle>
      </AttachmentContent>
    </Attachment>
  )
}

const AGENT_STATUS = {
  running: 'running',
  done: undefined,
  failed: 'error'
} as const

type SubagentStepProps = {
  part: Extract<ViewPart, { type: 'agent' }>
}

const SubagentStep = ({ part }: SubagentStepProps) => {
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={AGENT_STATUS[part.status]}>
          <TraceIcon>
            {part.status === 'failed' ? <CircleAlertIcon /> : <BotIcon />}
          </TraceIcon>
          <TraceTitle>
            {part.status === 'running' ? 'Running' : 'Ran'} the {part.name}{' '}
            agent
          </TraceTitle>
          {part.error === undefined ? null : (
            <TraceDescription>{part.error}</TraceDescription>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted className="flex flex-col gap-3">
        <AssistantParts
          parts={part.parts}
          isStreaming={part.status === 'running'}
        />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

type AssistantPartsProps = {
  parts: readonly ViewPart[]
  isStreaming: boolean
}

export const AssistantParts = ({ parts, isStreaming }: AssistantPartsProps) => {
  return (
    <Trace>
      {parts.map((part, index) => {
        const isPartStreaming = isStreaming && index === parts.length - 1

        if (part.type === 'text') {
          return (
            <ChatMarkdown
              // oxlint-disable-next-line react/no-array-index-key -- a text part has no id but its position in the message
              key={index}
              text={part.text}
              isStreaming={isPartStreaming}
            />
          )
        }

        if (part.type === 'reasoning') {
          return (
            <ReasoningStep
              // oxlint-disable-next-line react/no-array-index-key -- a reasoning part has no id but its position in the message
              key={index}
              text={part.text}
              isStreaming={isPartStreaming}
            />
          )
        }

        if (part.type === 'tool-call') {
          return <ToolStep key={part.id} part={part} />
        }

        if (part.type === 'agent') {
          return <SubagentStep key={part.id} part={part} />
        }

        return <MediaAttachment key={part.id} part={part} />
      })}
    </Trace>
  )
}
