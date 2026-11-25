import type { PermissionRule } from '@tanstack/ai-harness'
import { PUSH_DENIAL_REASON, ROOT_DENIAL_REASON } from '#/prompts/worker.ts'

const PROTECTED_BRANCHES = ['dev', 'main']

const PUSHES_TO_PROTECTED_BRANCHES = PROTECTED_BRANCHES.flatMap((branch) => {
  return [
    `git push * ${branch}`,
    `git push * ${branch} *`,
    `git push *:${branch}`,
    `git push *:${branch} *`,
    `git push *refs/heads/${branch}`,
    `git push *refs/heads/${branch} *`
  ]
})

const RISKY_PUSHES = [
  'git push',
  'git push origin',
  'git push * origin',
  'git push *HEAD',
  'git push *HEAD *',
  'git push *--force*',
  'git push *-f',
  'git push *-f *',
  'git push -*f *',
  'git push *+*',
  'git push *--all*',
  'git push *--mirror*',
  'git push *--delete*',
  'git push *-d',
  'git push *-d *',
  'git push * :*',
  'git -* push*'
]

export type CommandDenial = {
  reason: string
  rules: readonly PermissionRule[]
}

export function denyCommands(
  reason: string,
  resources: readonly string[]
): CommandDenial {
  return {
    reason,
    rules: resources.map((resource): PermissionRule => {
      return { tool: 'bash', resource, decision: 'deny', kind: 'execute' }
    })
  }
}

export const SANDBOX_DENIALS: readonly CommandDenial[] = [
  denyCommands(ROOT_DENIAL_REASON, ['sudo', 'sudo *', 'docker', 'docker *']),
  denyCommands(PUSH_DENIAL_REASON, [
    ...PUSHES_TO_PROTECTED_BRANCHES,
    ...RISKY_PUSHES
  ])
]

export const SANDBOX_PERMISSION_RULES = SANDBOX_DENIALS.flatMap(({ rules }) => {
  return rules
})

export const WEB_FETCH_RULE: PermissionRule = {
  tool: 'webfetch',
  decision: 'allow',
  kind: 'read'
}
