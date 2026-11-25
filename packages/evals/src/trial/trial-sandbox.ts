import {
  defineSandbox,
  type SandboxConfig,
  type SandboxHandle,
  type SandboxProvider,
  type WorkspaceDefinition
} from '@tanstack/ai-sandbox'
import type { EvalCase } from '#/cases/eval-case.ts'
import { gradeTrial } from './grade.ts'
import { InfrastructureError } from './infrastructure-error.ts'

const TRIAL_BASE_REF = 'refs/remotes/origin/trial-base'

function atBaseCommit(
  workspace: WorkspaceDefinition | undefined,
  baseCommit: string
): WorkspaceDefinition {
  if (workspace === undefined) {
    throw new InfrastructureError(
      'The sandbox of a trial needs a workspace that holds the repository of the case.'
    )
  }

  const { setup } = workspace

  return {
    ...workspace,
    setup: (builder) => {
      builder.serial(
        `git cat-file -e ${baseCommit}^{commit} 2>/dev/null || git fetch --quiet origin ${baseCommit}`
      )
      builder.serial(`git checkout --quiet --detach ${baseCommit}`)
      builder.serial(
        "git for-each-ref --format='delete %(refname)' | git update-ref --no-deref --stdin"
      )
      builder.serial(`git update-ref ${TRIAL_BASE_REF} ${baseCommit}`)
      builder.serial('git reflog expire --expire=now --all')

      if (typeof setup === 'function') {
        setup(builder)
      } else {
        for (const command of setup ?? []) {
          builder.serial(command)
        }
      }
    }
  }
}

function watchedProvider(
  provider: SandboxProvider,
  remember: (handle: SandboxHandle) => SandboxHandle
): SandboxProvider {
  const { restoreSnapshot, deleteSnapshot } = provider

  return {
    name: provider.name,
    capabilities: () => {
      return provider.capabilities()
    },
    create: async (input) => {
      return remember(await provider.create(input))
    },
    resume: async (input) => {
      const resumed = await provider.resume(input)

      return resumed === null ? null : remember(resumed)
    },
    ...(restoreSnapshot === undefined
      ? {}
      : {
          restoreSnapshot: async (input) => {
            return remember(await restoreSnapshot.call(provider, input))
          }
        }),
    ...(deleteSnapshot === undefined
      ? {}
      : {
          deleteSnapshot: async (input) => {
            await deleteSnapshot.call(provider, input)
          }
        }),
    destroy: async (input) => {
      await provider.destroy(input)
    }
  }
}

export function trialSandbox(config: SandboxConfig, evalCase: EvalCase) {
  let handle: SandboxHandle | null = null

  const definition = defineSandbox({
    ...config,
    provider: watchedProvider(config.provider, (ready) => {
      handle = ready

      return ready
    }),
    workspace: atBaseCommit(config.workspace, evalCase.baseCommit)
  })

  const grade = async (threadId: string) => {
    if (handle !== null) {
      return gradeTrial(handle, evalCase)
    }

    const untouched = await definition.ensure({ threadId, runId: threadId })

    try {
      return await gradeTrial(untouched, evalCase)
    } finally {
      await untouched.destroy()
    }
  }

  return { definition, grade }
}

export type TrialSandbox = ReturnType<typeof trialSandbox>
