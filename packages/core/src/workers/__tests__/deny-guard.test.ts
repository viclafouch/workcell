import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PermissionMode } from '@tanstack/ai-harness'
import { createHostFreeSandbox } from '#/testing/host-free-sandbox.ts'
import { runWorkerToolCall } from '#/testing/tool-call.ts'

const RULE_DENIAL = 'A permission rule denies this tool.'

let hostFree: Awaited<ReturnType<typeof createHostFreeSandbox>>

function runBash(command: string, mode: PermissionMode) {
  return runWorkerToolCall({
    hostFree,
    toolCall: { name: 'bash', input: { command } },
    mode
  })
}

describe('the refusals of the deny guard', () => {
  beforeAll(async () => {
    hostFree = await createHostFreeSandbox({})
  })

  afterAll(async () => {
    await hostFree.destroy()
  })

  it.each([
    ['sudo ls', 'acceptEdits', 'no root and no Docker'],
    ['docker ps', 'bypass', 'no root and no Docker'],
    ['git push origin main', 'acceptEdits', 'git push origin <your-branch>'],
    [
      'git push --force origin task-1-fix',
      'bypass',
      'git push origin <your-branch>'
    ]
  ] as const)(
    'tells why %s is refused in %s mode, and what to do instead',
    async (command, mode, reason) => {
      const run = await runBash(command, mode)

      expect(run.result).toContain(RULE_DENIAL)
      expect(run.result).toContain(reason)
    }
  )
})
