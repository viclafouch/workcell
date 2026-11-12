import type { PermissionRule } from '@tanstack/ai-harness'

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

const DENIED_COMMANDS = [
  'sudo',
  'sudo *',
  'docker',
  'docker *',
  ...PUSHES_TO_PROTECTED_BRANCHES,
  ...RISKY_PUSHES
]

export const SANDBOX_PERMISSION_RULES: PermissionRule[] = DENIED_COMMANDS.map(
  (resource) => {
    return { tool: 'bash', resource, decision: 'deny', kind: 'execute' }
  }
)
