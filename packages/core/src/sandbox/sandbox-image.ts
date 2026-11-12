import { randomUUID } from 'node:crypto'
import Dockerode from 'dockerode'
import type { SandboxDefinition } from '@tanstack/ai-sandbox'
import { findImage, hasStatus, isNotFound } from './proxied-docker-sandbox.ts'

const BASE_IMAGE_LABEL = 'workcell.base-image'

const SETUP_LABEL = 'workcell.image-setup'

const VERSION_LABEL = 'workcell.image-version'

const REFRESHES_LABEL = 'workcell.image-refreshes'

const IMAGE_THREAD = 'workcell/sandbox-image'

const IMAGE_CONTEXT = { threadId: IMAGE_THREAD, runId: IMAGE_THREAD }

const CONFLICT_STATUS = 409

type EnsureSandboxImageParams = {
  tag: string
  baseImage: string
  build: SandboxDefinition
  refresh: SandboxDefinition
  version: string
  maxRefreshes: number
  logger: {
    info: (details: Record<string, unknown>, message: string) => void
  }
}

async function inspectImage(docker: Dockerode, tag: string) {
  try {
    return await docker.getImage(tag).inspect()
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }

    throw error
  }
}

async function removeImage(docker: Dockerode, id: string) {
  try {
    await docker.getImage(id).remove()
  } catch (error) {
    if (!isNotFound(error) && !hasStatus(error, CONFLICT_STATUS)) {
      throw error
    }
  }
}

type ImageCommit = {
  sandbox: SandboxDefinition
  tag: string
  labels: Readonly<Record<string, string>>
}

async function commitSetup(
  docker: Dockerode,
  { sandbox, tag, labels }: ImageCommit
) {
  const handle = await sandbox.ensure({
    threadId: `${IMAGE_THREAD}/${randomUUID()}`,
    runId: randomUUID()
  })

  try {
    await docker.getContainer(handle.id).commit({
      repo: tag,
      changes: `LABEL ${Object.entries(labels)
        .map(([name, value]) => {
          return `${name}=${value}`
        })
        .join(' ')}`
    })
  } finally {
    await sandbox.provider.destroy({ id: handle.id })
  }
}

export async function ensureSandboxImage({
  tag,
  baseImage,
  build,
  refresh,
  version,
  maxRefreshes,
  logger
}: EnsureSandboxImageParams) {
  const docker = new Dockerode()
  const [base, current] = await Promise.all([
    findImage(docker, baseImage),
    inspectImage(docker, tag)
  ])
  const labels = current?.Config.Labels ?? {}
  const setup = [build, refresh]
    .map((sandbox) => {
      return sandbox.key(IMAGE_CONTEXT)
    })
    .join('+')
  const hasSameSetup =
    current !== null &&
    labels[BASE_IMAGE_LABEL] === base.Id &&
    labels[SETUP_LABEL] === setup

  if (hasSameSetup && labels[VERSION_LABEL] === version) {
    return
  }

  const refreshes = Number(labels[REFRESHES_LABEL])
  const canRefresh = hasSameSetup && refreshes < maxRefreshes
  const nextRefreshes = canRefresh ? refreshes + 1 : 0
  await commitSetup(docker, {
    sandbox: canRefresh ? refresh : build,
    tag,
    labels: {
      [BASE_IMAGE_LABEL]: base.Id,
      [SETUP_LABEL]: setup,
      [VERSION_LABEL]: version,
      [REFRESHES_LABEL]: String(nextRefreshes)
    }
  })
  logger.info(
    { tag, version, refreshes: nextRefreshes },
    canRefresh ? 'sandbox image refreshed' : 'sandbox image built'
  )

  if (current !== null) {
    await removeImage(docker, current.Id)
  }
}
