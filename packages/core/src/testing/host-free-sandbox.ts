import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HarnessHost } from '@tanstack/ai-harness'
import {
  defineSandbox,
  type SandboxHandle,
  type SandboxProvider
} from '@tanstack/ai-sandbox'
import { localProcessSandbox } from '@tanstack/ai-sandbox-local-process'
import { workcellTracer } from '#/telemetry/worker-telemetry.ts'
import { createWorkerLifecycle } from '#/workers/lifecycle.ts'
import { FREE_MODEL_PRICING, TEST_MAX_RUNNING_TURNS } from './test-doubles.ts'

const SILENT_WORKER_LOGGER = {
  child: () => {
    return { info: () => {}, warn: () => {}, error: () => {} }
  }
}

export const HOST_FREE_REPOSITORY = 'host-free/repository'

const FIXED_WORKSPACE_SANDBOX = {
  rebind: async () => {},
  save: async () => {
    return null
  },
  forget: async () => {}
}

async function exists(path: string) {
  try {
    await stat(path)

    return true
  } catch {
    return false
  }
}

async function makeWritable(path: string) {
  if (await exists(path)) {
    execFileSync('chmod', ['-R', 'u+w', path])
  }
}

function withWritableDestroy(sandbox: SandboxHandle) {
  const destroy = sandbox.destroy.bind(sandbox)

  return Object.assign(sandbox, {
    destroy: async () => {
      await makeWritable(sandbox.id)
      await destroy()
    }
  })
}

export async function createHostFreeProvider() {
  const root = await mkdtemp(join(tmpdir(), 'host-free-'))
  const home = join(root, 'home')
  await mkdir(home)
  const local = localProcessSandbox({ baseDir: join(root, 'sandboxes') })
  const keysById = new Map<string, string>()
  const provider: SandboxProvider = {
    name: local.name,
    capabilities: () => {
      return local.capabilities()
    },
    create: async (input) => {
      const sandbox = await local.create(input)
      await sandbox.env.set({ ...input.env, HOME: home })
      keysById.set(sandbox.id, input.id ?? sandbox.id)

      return withWritableDestroy(sandbox)
    },
    resume: async (input) => {
      const sandbox = await local.resume(input)

      if (sandbox === null) {
        return null
      }

      await sandbox.env.set({ HOME: home })

      return withWritableDestroy(sandbox)
    },
    destroy: async (input) => {
      await makeWritable(input.id)
      await local.destroy(input)
    }
  }

  return {
    provider,
    list: async () => {
      const listed = await Promise.all(
        keysById.entries().map(async ([id, key]) => {
          return (await exists(id)) ? [{ id, key }] : []
        })
      )

      return listed.flat()
    },
    destroy: async () => {
      await makeWritable(root)
      await rm(root, { recursive: true, force: true })
    }
  }
}

export async function createHostFreeSandbox(env: Record<string, string> = {}) {
  const hostFree = await createHostFreeProvider()
  const sandbox = await hostFree.provider.create({ env })

  return {
    sandbox,
    provider: hostFree.provider,
    list: hostFree.list,
    destroy: async () => {
      await sandbox.destroy()
      await hostFree.destroy()
    }
  }
}

export function createHostFreeLifecycle(
  host: HarnessHost,
  { provider, list }: Awaited<ReturnType<typeof createHostFreeSandbox>>
) {
  return createWorkerLifecycle({
    host,
    sandboxes: {
      [HOST_FREE_REPOSITORY]: defineSandbox({ id: 'host-free', provider })
    },
    sandboxProvider: { destroy: provider.destroy, list },
    sharedSandboxKeys: [],
    workerSandbox: FIXED_WORKSPACE_SANDBOX,
    logger: SILENT_WORKER_LOGGER,
    secretValues: [],
    maxRunningTurns: TEST_MAX_RUNNING_TURNS,
    pricing: FREE_MODEL_PRICING,
    tracer: workcellTracer()
  })
}
