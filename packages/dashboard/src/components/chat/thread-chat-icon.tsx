import { BotIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { chatAdapterOf } from '#/lib/chat-input.ts'
import { getChatMarksQueryOpts } from '#/queries/chat.ts'
import { ChatMarkIcon } from './chat-mark-icon.tsx'

type ThreadChatIconProps = {
  threadId: string
}

export const ThreadChatIcon = ({ threadId }: ThreadChatIconProps) => {
  const chatMarksQuery = useQuery(getChatMarksQueryOpts())
  const adapter = chatAdapterOf(threadId)
  const chatMark = chatMarksQuery.data?.find((candidate) => {
    return candidate.adapter === adapter
  })

  return chatMark === undefined ? (
    <BotIcon aria-hidden />
  ) : (
    <ChatMarkIcon chatMark={chatMark} />
  )
}
