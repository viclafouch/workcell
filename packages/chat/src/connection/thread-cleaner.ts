import type { Chat } from 'chat'

type DeleteMessageParams = { threadId: string; messageId: string }

export function createThreadCleaner(chat: Chat) {
  const botMessagesOf = async (threadId: string) => {
    const messageIds: string[] = []

    for await (const message of chat.thread(threadId).allMessages) {
      if (message.author.isMe) {
        messageIds.push(message.id)
      }
    }

    return messageIds
  }

  const deleteMessage = async ({
    threadId,
    messageId
  }: DeleteMessageParams) => {
    await chat.thread(threadId).adapter.deleteMessage(threadId, messageId)
  }

  return { botMessagesOf, deleteMessage }
}

export type ThreadCleaner = ReturnType<typeof createThreadCleaner>
