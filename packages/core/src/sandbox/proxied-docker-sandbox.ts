import { randomUUID } from 'node:crypto'
import Dockerode from 'dockerode'
import type {
  SandboxCapabilities,
  SandboxCreateInput,
  SandboxHandle,
  SandboxProvider
} from '@tanstack/ai-sandbox'
import { DOCKER_CAPS, DockerHandle } from '@tanstack/ai-sandbox-docker'
import type { CredentialProxy } from './egress/credential-proxy.ts'
import type { SandboxEgress } from './egress/egress-policy.ts'
import {
  configureRelay,
  createRelay,
  EGRESS_LABEL,
  ensureRelayRunning,
  HOST_GATEWAY_NAME,
  RELAY_IMAGE,
  relayAddress,
  removeRelay,
  trustEgressAuthority
} from './egress/sandbox-relay.ts'

const WORKDIR = '/workspace'
const AGENT_HOME = '/home/agent'
const SANDBOX_LABEL = 'workcell.sandbox'
const UNNAMED_SANDBOX = 'unnamed'
const NOT_FOUND_STATUS = 404
const BYTES_PER_GIBIBYTE = 1_073_741_824
const SANDBOX_MEMORY_GIBIBYTES = 6
const SANDBOX_MEMORY_BYTES = SANDBOX_MEMORY_GIBIBYTES * BYTES_PER_GIBIBYTE

const DEFAULT_KEEP_ALIVE_COMMAND = ['tail', '-f', '/dev/null']

const CAPABILITIES: SandboxCapabilities = {
  ...DOCKER_CAPS,
  snapshots: false,
  fork: false
}

type LogLine = (details: Record<string, unknown>, message: string) => void

type ListedSandbox = { id: string; key: string }

type CacheVolume = { name: string; mountPath: string }

export type ProxiedDockerSandboxParams = {
  image: string
  egress: SandboxEgress
  credentialProxy: Pick<
    CredentialProxy,
    'port' | 'registerSandbox' | 'forgetSandbox'
  >
  logger: { info: LogLine; warn: LogLine }
  proxyHost?: string
  relayImage?: string
  keepAliveCommand?: string[]
  sandboxEnv?: Readonly<Record<string, string>>
  labels?: Readonly<Record<string, string>>
  cacheVolumes?: readonly CacheVolume[]
}

type SandboxContainerDefinitionParams = Required<
  Pick<
    ProxiedDockerSandboxParams,
    'image' | 'keepAliveCommand' | 'sandboxEnv' | 'labels' | 'cacheVolumes'
  >
> & { key: string; egressName: string; dnsAddress: string }

function toMounts(
  cacheVolumes: readonly CacheVolume[]
): Dockerode.MountSettings[] {
  return cacheVolumes.map(({ name, mountPath }) => {
    return { Type: 'volume', Source: name, Target: mountPath }
  })
}

export function sandboxContainerDefinition({
  key,
  image,
  keepAliveCommand,
  sandboxEnv,
  labels,
  cacheVolumes,
  egressName,
  dnsAddress
}: SandboxContainerDefinitionParams): Dockerode.ContainerCreateOptions {
  return {
    Image: image,
    Cmd: keepAliveCommand,
    WorkingDir: WORKDIR,
    Env: Object.entries({ ...sandboxEnv, NODE_USE_SYSTEM_CA: '1' }).map(
      ([name, value]) => {
        return `${name}=${value}`
      }
    ),
    Labels: { ...labels, [SANDBOX_LABEL]: key, [EGRESS_LABEL]: egressName },
    HostConfig: {
      NetworkMode: egressName,
      Dns: [dnsAddress],
      Memory: SANDBOX_MEMORY_BYTES,
      MemorySwap: SANDBOX_MEMORY_BYTES,
      Mounts: toMounts(cacheVolumes)
    }
  }
}

async function seedCacheVolumes(
  docker: Dockerode,
  image: string,
  cacheVolumes: readonly CacheVolume[]
) {
  if (cacheVolumes.length === 0) {
    return
  }

  const seed = await docker.createContainer({
    Image: image,
    NetworkDisabled: true,
    HostConfig: { Mounts: toMounts(cacheVolumes) }
  })
  await seed.remove({ force: true })
}

export function hasStatus(error: unknown, status: number) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === status
  )
}

export function isNotFound(error: unknown) {
  return hasStatus(error, NOT_FOUND_STATUS)
}

export async function findImage(docker: Dockerode, tag: string) {
  try {
    return await docker.getImage(tag).inspect()
  } catch (error) {
    if (isNotFound(error)) {
      throw new Error(
        `The Docker image ${tag} is missing: build it before the first sandbox.`,
        { cause: error }
      )
    }

    throw error
  }
}

function refuseFork(): never {
  throw new Error('A proxied Docker sandbox does not fork.')
}

async function egressNameOf(container: Dockerode.Container) {
  const { Config } = await container.inspect()

  return Config.Labels[EGRESS_LABEL] ?? null
}

export async function destroyProxiedDockerSandbox(id: string) {
  const docker = new Dockerode()
  const container = docker.getContainer(id)
  let egressName: string | null = null

  try {
    egressName = await egressNameOf(container)
    await container.remove({ force: true, v: true })
  } catch (error) {
    if (!isNotFound(error)) {
      throw error
    }
  }

  if (egressName !== null) {
    await removeRelay(docker, egressName)
  }
}

export function proxiedDockerSandbox({
  image,
  egress,
  credentialProxy,
  proxyHost = HOST_GATEWAY_NAME,
  relayImage = RELAY_IMAGE,
  logger,
  keepAliveCommand = DEFAULT_KEEP_ALIVE_COMMAND,
  sandboxEnv = {},
  labels = {},
  cacheVolumes = []
}: ProxiedDockerSandboxParams): SandboxProvider & {
  list: () => Promise<ListedSandbox[]>
} {
  const docker = new Dockerode()
  let seeding: Promise<void> | null = null

  async function seedOnce() {
    seeding ??= seedCacheVolumes(docker, image, cacheVolumes)
    const attempt = seeding

    try {
      await attempt
    } catch (error) {
      if (seeding === attempt) {
        seeding = null
      }

      throw error
    }
  }
  const teardownLogger = {
    warn: (message: string, meta: Record<string, unknown> = {}) => {
      logger.warn(meta, message)
    }
  }

  async function connectEgress(
    sandbox: Dockerode.Container,
    egressName: string
  ) {
    const relay = docker.getContainer(egressName)
    await ensureRelayRunning(relay)
    const registration = await credentialProxy.registerSandbox({
      id: sandbox.id,
      egress
    })
    await configureRelay({
      relay,
      egressName,
      registration,
      proxy: { host: proxyHost, port: credentialProxy.port }
    })
    await trustEgressAuthority(sandbox, registration.certificateAuthority)
  }

  async function removeSandbox(id: string, egressName: string | null) {
    credentialProxy.forgetSandbox(id)

    try {
      await docker.getContainer(id).remove({ force: true, v: true })
    } catch (error) {
      if (!isNotFound(error)) {
        throw error
      }
    }

    if (egressName !== null) {
      await removeRelay(docker, egressName)
    }

    logger.info({ sandboxId: id }, 'sandbox destroyed')
  }

  class ProxiedDockerHandle extends DockerHandle {
    override async destroy() {
      const egressName = await egressNameOf(docker.getContainer(this.id))
      await super.destroy()
      await removeSandbox(this.id, egressName)
    }
  }

  async function toHandle(
    container: Dockerode.Container
  ): Promise<SandboxHandle> {
    const handle = new ProxiedDockerHandle({
      docker,
      container,
      workdir: WORKDIR,
      forkFactory: refuseFork,
      removeOnDestroy: true,
      logger: teardownLogger
    })
    await handle.env.set({ HOME: AGENT_HOME })

    return handle
  }

  async function startSandbox(key: string) {
    const egressName = `workcell-egress-${randomUUID()}`
    const relay = await createRelay(docker, { egressName, relayImage })

    const container = await docker.createContainer(
      sandboxContainerDefinition({
        key,
        image,
        keepAliveCommand,
        sandboxEnv,
        labels,
        cacheVolumes,
        egressName,
        dnsAddress: await relayAddress(relay, egressName)
      })
    )

    try {
      await container.start()
      await connectEgress(container, egressName)
    } catch (error) {
      await removeSandbox(container.id, egressName)
      throw error
    }

    return container
  }

  return {
    name: 'docker',
    capabilities: () => {
      return CAPABILITIES
    },
    create: async ({ id, env }: SandboxCreateInput) => {
      await findImage(docker, image)
      await seedOnce()
      const container = await startSandbox(id ?? UNNAMED_SANDBOX)
      logger.info({ sandboxId: container.id }, 'sandbox created')
      const handle = await toHandle(container)

      if (env !== undefined) {
        await handle.env.set(env)
      }

      return handle
    },
    resume: async ({ id }) => {
      const container = docker.getContainer(id)

      try {
        const { State, Config } = await container.inspect()
        const egressName = Config.Labels[EGRESS_LABEL]

        if (egressName === undefined) {
          await removeSandbox(id, null)

          return null
        }

        if (!State.Running) {
          await container.start()
        }

        await connectEgress(container, egressName)
      } catch (error) {
        if (isNotFound(error)) {
          return null
        }

        throw error
      }

      logger.info({ sandboxId: id }, 'sandbox reattached')

      return toHandle(container)
    },
    list: async () => {
      const containers = await docker.listContainers({
        all: true,
        filters: { label: [SANDBOX_LABEL] }
      })

      return containers.map(({ Id, Labels }) => {
        return { id: Id, key: Labels[SANDBOX_LABEL] ?? UNNAMED_SANDBOX }
      })
    },
    destroy: async ({ id }) => {
      credentialProxy.forgetSandbox(id)
      await destroyProxiedDockerSandbox(id)
      logger.info({ sandboxId: id }, 'sandbox destroyed')
    }
  }
}
