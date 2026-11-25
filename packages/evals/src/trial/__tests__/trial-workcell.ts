import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defineSandbox,
  defineWorkspace,
  type SandboxConfig
} from '@tanstack/ai-sandbox'
import { fakeText, type FakeResponseStep } from '@tanstack/ai/testing'
import { createModelPricing, openWorkcell } from '@workcell/core'
import {
  createHostFreeSandbox,
  openTestDatabase,
  SILENT_HOST_LOGGER,
  TEST_STARTER
} from '@workcell/core/testing'
import type { EvalCase } from '#/cases/eval-case.ts'
import type { OpenTrialWorkcell } from '#/trial/worker-harness.ts'

const TRIAL_REPOSITORY = 'acme/app'

const ROOMY_LIMITS = { maxCostUsd: 100 }

const FREE_PRICING = createModelPricing({
  'fake-model': { input: 0, output: 0 }
})

const SILENT_LOGGER = {
  child: () => {
    return SILENT_HOST_LOGGER
  }
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

export async function createOrigin() {
  const origin = await mkdtemp(join(tmpdir(), 'trial-origin-'))
  git(origin, 'init', '--quiet', '--initial-branch', 'main')
  git(origin, 'config', 'user.email', 'person@example.com')
  git(origin, 'config', 'user.name', 'A person')
  await writeFile(join(origin, 'greeting.txt'), 'hello\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '--quiet', '-m', 'Say hello')
  const baseCommit = git(origin, 'rev-parse', 'HEAD')
  await writeFile(join(origin, 'greeting.txt'), 'hello there\n')
  git(origin, 'commit', '--quiet', '-am', 'Say more')

  return {
    url: origin,
    baseCommit,
    branches: () => {
      return git(origin, 'branch', '--format=%(refname:short)').split('\n')
    },
    [Symbol.asyncDispose]: async () => {
      await rm(origin, { recursive: true, force: true })
    }
  }
}

export function greetingCase(baseCommit: string, verifier: string): EvalCase {
  return {
    name: 'say-hi',
    instruction: 'Change the greeting to hi.\n',
    repository: TRIAL_REPOSITORY,
    baseCommit,
    pullRequest: 'https://github.com/acme/app/pull/1',
    threadId: 'thread-of-the-task',
    outcome: { value: 'flawed', costUsd: 1 },
    solution: '',
    verifier
  }
}

export async function openTrialTestbed(databaseUrl: string) {
  const hostFree = await createHostFreeSandbox()

  const sandboxAt = (originUrl: string): SandboxConfig => {
    return {
      id: 'trial-test',
      provider: hostFree.provider,
      workspace: defineWorkspace({
        source: { type: 'git', url: originUrl, ref: 'main', depth: 'full' }
      }),
      lifecycle: { reuse: 'thread', snapshot: 'none' }
    }
  }

  const openTrialWorkcell = (
    responses: FakeResponseStep[]
  ): OpenTrialWorkcell => {
    return async ({ sandboxes, plugins, permissionMode }) => {
      const model = fakeText()
      model.setResponses(responses)
      const database = openTestDatabase(databaseUrl)
      const workcell = await openWorkcell({
        database,
        migrateCommand: 'pnpm db:migrate',
        logger: SILENT_LOGGER,
        models: { orchestrator: model, worker: model, compaction: model },
        pricing: FREE_PRICING,
        secrets: {},
        sandboxes,
        sandboxProvider: {
          destroy: hostFree.provider.destroy,
          list: hostFree.list
        },
        library: {
          sandbox: defineSandbox({
            id: 'trial-test-library',
            provider: hostFree.provider,
            workspace: defineWorkspace({ source: { type: 'none' } }),
            lifecycle: { reuse: 'thread', snapshot: 'none' }
          }),
          repositories: {},
          pullIntervalMs: 60_000
        },
        senders: {
          starterIds: [TEST_STARTER.id],
          isColleagueThread: () => {
            return false
          }
        },
        orchestrator: {
          name: 'Orchestrator',
          limits: ROOMY_LIMITS,
          plugins: []
        },
        gitIdentity: {
          name: 'Host Developer',
          email: 'host@example.com',
          coAuthorEmail: 'noreply@example.com'
        },
        workerNames: ['Alpha'],
        skills: { dirs: [] },
        defaultLimits: ROOMY_LIMITS,
        plugins,
        permissionMode,
        maxRunningTurns: 2
      })

      return {
        ...workcell,
        [Symbol.asyncDispose]: async () => {
          await workcell[Symbol.asyncDispose]()
          await database.close()
        }
      }
    }
  }

  return {
    sandboxAt,
    openTrialWorkcell,
    [Symbol.asyncDispose]: async () => {
      await hostFree.destroy()
    }
  }
}
