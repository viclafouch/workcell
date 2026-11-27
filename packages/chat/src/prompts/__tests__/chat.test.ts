import { describe, expect, it } from 'vitest'
import { CHAT_LINES } from '#/prompts/chat.ts'

describe('the default words of a tool call in the chat', () => {
  it('name a tool the agents know in plain words', () => {
    expect(CHAT_LINES.toolTask('grep')).toBe('Searching the code')
  })

  it('never show the name of a tool they do not know', () => {
    expect(CHAT_LINES.toolTask('acme_deploy')).toBe('Using a tool')
  })
})
