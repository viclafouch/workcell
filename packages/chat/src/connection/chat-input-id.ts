export function chatInputId(threadId: string, messageId: string) {
  return `chat:${threadId}:${messageId}`
}
