const ADAPTER_SEPARATOR = ':'

const CHAT_INPUT = /^user-(?:person:)?(?<inputId>chat:(?<threadId>.+):[^:]+)$/u

export const chatAdapterOf = (chatThreadId: string) => {
  return chatThreadId.split(ADAPTER_SEPARATOR, 1)[0] ?? ''
}

export const chatInputOf = (messageId: string) => {
  const groups = CHAT_INPUT.exec(messageId)?.groups

  return groups?.inputId === undefined || groups.threadId === undefined
    ? null
    : { inputId: groups.inputId, threadId: groups.threadId }
}

export const chatThreadOfMessages = (
  messages: readonly { id: string; role: string }[]
) => {
  for (const message of messages) {
    const chatInput = message.role === 'user' ? chatInputOf(message.id) : null

    if (chatInput !== null) {
      return chatInput.threadId
    }
  }

  return null
}
