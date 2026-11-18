import Dockerode from 'dockerode'
import type {
  SandboxCapabilities,
  SandboxCreateInput,
  SandboxHandle,
  SandboxProvider
} from '@tanstack/ai-sandbox'
import { DOCKER_CAPS, DockerHandle } from '@tanstack/ai-sandbox-docker'
import { AsyncRetryer } from '@tanstack/pacer'

const SANDBOX_NETWORK = 'workcell-sandbox'
const SANDBOX_SUBNET = '10.231.0.0/24'
const EGRESS_NETWORK = 'workcell-egress-out'
const EGRESS_CONTAINER = 'workcell-egress'
const EGRESS_ADDRESS = '10.231.0.2'
const WORKDIR = '/workspace'
const AGENT_HOME = '/home/agent'
const SANDBOX_LABEL = 'workcell.sandbox'
const UNNAMED_SANDBOX = 'unnamed'
const NOT_FOUND_STATUS = 404
const CONFLICT_STATUS = 409
const EGRESS_ATTEMPTS = 5
const EGRESS_RETRY_WAIT_MS = 500
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
  egressImage: string
  logger: { info: LogLine; warn: LogLine }
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
> & { key: string }

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
  cacheVolumes
}: SandboxContainerDefinitionParams): Dockerode.ContainerCreateOptions {
  return {
    Image: image,
    Cmd: keepAliveCommand,
    WorkingDir: WORKDIR,
    Env: Object.entries(sandboxEnv).map(([name, value]) => {
      return `${name}=${value}`
    }),
    Labels: { ...labels, [SANDBOX_LABEL]: key },
    HostConfig: {
      NetworkMode: SANDBOX_NETWORK,
      Dns: [EGRESS_ADDRESS],
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

async function ensureNetwork(
  docker: Dockerode,
  network: Dockerode.NetworkCreateOptions
) {
  const networks = await docker.listNetworks({
    filters: { name: [network.Name] }
  })

  if (
    networks.some(({ Name }) => {
      return Name === network.Name
    })
  ) {
    return
  }

  await docker.createNetwork(network)
}

async function ensureNetworks(docker: Dockerode) {
  await Promise.all([
    ensureNetwork(docker, {
      Name: SANDBOX_NETWORK,
      Internal: true,
      IPAM: { Config: [{ Subnet: SANDBOX_SUBNET }] }
    }),
    ensureNetwork(docker, { Name: EGRESS_NETWORK })
  ])
}

async function startEgressProxy(
  docker: Dockerode,
  egressImage: string,
  imageId: string
) {
  const container = docker.getContainer(EGRESS_CONTAINER)

  try {
    const { Image, State } = await container.inspect()

    if (Image === imageId) {
      if (!State.Running) {
        await container.start()
      }

      return
    }

    await container.remove({ force: true })
  } catch (error) {
    if (!isNotFound(error)) {
      throw error
    }
  }

  const egress = await docker.createContainer({
    name: EGRESS_CONTAINER,
    Image: egressImage,
    Env: [`EGRESS_ADDRESS=${EGRESS_ADDRESS}`],
    HostConfig: {
      NetworkMode: EGRESS_NETWORK,
      RestartPolicy: { Name: 'unless-stopped' }
    }
  })
  await docker.getNetwork(SANDBOX_NETWORK).connect({
    Container: egress.id,
    EndpointConfig: { IPAMConfig: { IPv4Address: EGRESS_ADDRESS } }
  })
  await egress.start()
}

async function ensureEgressProxy(docker: Dockerode, egressImage: string) {
  const image = await findImage(docker, egressImage)
  const failure = await new AsyncRetryer(
    async () => {
      try {
        await startEgressProxy(docker, egressImage, image.Id)

        return null
      } catch (error) {
        if (hasStatus(error, CONFLICT_STATUS)) {
          throw error
        }

        return error
      }
    },
    {
      maxAttempts: EGRESS_ATTEMPTS,
      baseWait: EGRESS_RETRY_WAIT_MS,
      jitter: 0.25
    }
  ).execute()

  if (failure !== null && failure !== undefined) {
    throw new Error('The egress proxy did not start.', { cause: failure })
  }
}

function refuseFork(): never {
  throw new Error('A proxied Docker sandbox does not fork.')
}

export function proxiedDockerSandbox({
  image,
  egressImage,
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

  class ProxiedDockerHandle extends DockerHandle {
    override async destroy() {
      await super.destroy()
      logger.info({ sandboxId: this.id }, 'sandbox destroyed')
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

  return {
    name: 'docker',
    capabilities: () => {
      return CAPABILITIES
    },
    create: async ({ id, env }: SandboxCreateInput) => {
      await findImage(docker, image)
      await ensureNetworks(docker)
      await ensureEgressProxy(docker, egressImage)
      await seedOnce()
      const container = await docker.createContainer(
        sandboxContainerDefinition({
          key: id ?? UNNAMED_SANDBOX,
          image,
          keepAliveCommand,
          sandboxEnv,
          labels,
          cacheVolumes
        })
      )
      try {
        await container.start()
      } catch (error) {
        await container.remove({ force: true, v: true })
        throw error
      }

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
        const { State } = await container.inspect()

        if (!State.Running) {
          await container.start()
        }
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
      const container = docker.getContainer(id)

      try {
        await container.remove({ force: true, v: true })
      } catch (error) {
        if (!isNotFound(error)) {
          throw error
        }
      }

      logger.info({ sandboxId: id }, 'sandbox destroyed')
    }
  }
}
