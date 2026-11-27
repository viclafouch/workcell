import { InfoIcon, TriangleAlertIcon } from 'lucide-react'
import type { ViewMessage } from '@tanstack/ai-harness/view'
import { ChatMarkdown } from '#/components/markdown/chat-markdown.tsx'
import { Alert, AlertDescription } from '#/components/ui/alert.tsx'
import { Bubble, BubbleContent } from '#/components/ui/bubble.tsx'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '#/components/ui/message-scroller.tsx'
import { Message, MessageContent } from '#/components/ui/message.tsx'
import { AssistantParts } from './assistant-parts.tsx'

type ChatTurnProps = {
  message: ViewMessage
}

const ChatTurn = ({ message }: ChatTurnProps) => {
  if (message.role === 'user') {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="muted">
            <BubbleContent dir="auto">
              <ChatMarkdown text={message.text} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }

  if (message.role === 'notice') {
    const isError = message.kind === 'error'

    return (
      <Alert variant={isError ? 'destructive' : 'default'}>
        {isError ? <TriangleAlertIcon aria-hidden /> : <InfoIcon aria-hidden />}
        <AlertDescription>{message.text}</AlertDescription>
      </Alert>
    )
  }

  return (
    <Message>
      <MessageContent>
        <AssistantParts parts={message.parts} />
      </MessageContent>
    </Message>
  )
}

type SessionChatProps = {
  messages: readonly ViewMessage[]
  isStreaming: boolean
}

export const SessionChat = ({ messages, isStreaming }: SessionChatProps) => {
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="h-full min-h-0 rounded-xl border bg-card">
        <MessageScrollerViewport>
          <MessageScrollerContent
            aria-label="Transcript"
            aria-busy={isStreaming}
            className="p-4 sm:p-6"
          >
            {messages.map((message) => {
              return (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === 'user'}
                >
                  <ChatTurn message={message} />
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
