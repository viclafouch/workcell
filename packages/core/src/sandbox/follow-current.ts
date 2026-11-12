import type { BoundWorkspace } from '@tanstack/ai-harness/plugins/coding'
import type { sandboxWorkspaceBackend } from '@tanstack/ai-sandbox/harness'

export type SandboxBackend = ReturnType<typeof sandboxWorkspaceBackend>

export function followCurrent(
  root: string,
  current: () => SandboxBackend
): BoundWorkspace {
  const { spawn } = current()

  return {
    root,
    shell: 'sh',
    binding: () => {
      return current().binding()
    },
    killJob: (...args) => {
      return current().killJob(...args)
    },
    readFile: (...args) => {
      return current().readFile(...args)
    },
    writeFile: (...args) => {
      return current().writeFile(...args)
    },
    remove: (...args) => {
      return current().remove(...args)
    },
    readLines: (...args) => {
      return current().readLines(...args)
    },
    stat: (...args) => {
      return current().stat(...args)
    },
    realpath: (...args) => {
      return current().realpath(...args)
    },
    readdir: (...args) => {
      return current().readdir(...args)
    },
    exec: (...args) => {
      return current().exec(...args)
    },
    ...(spawn && {
      spawn: (...args) => {
        const { spawn: currentSpawn } = current()

        if (currentSpawn === undefined) {
          throw new Error('This sandbox runs no background job.')
        }

        return currentSpawn(...args)
      }
    }),
    close: (...args) => {
      return current().close(...args)
    }
  }
}
