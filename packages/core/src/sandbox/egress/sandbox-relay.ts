import { readFile } from 'node:fs/promises'
import { text } from 'node:stream/consumers'
import type Dockerode from 'dockerode'
import type { SandboxRegistration } from './credential-proxy.ts'

export const RELAY_IMAGE =
  'node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5'
export const HOST_GATEWAY_NAME = 'host.docker.internal'
export const EGRESS_LABEL = 'workcell.egress'

const RELAY_NETWORK = 'workcell-relays'
const RELAY_SOURCE_URL = new URL('relay-sidecar.ts', import.meta.url)
const NOT_FOUND_STATUS = 404

const WRITE_RELAY_CONFIG = [
  'mkdir -p /run/workcell-relay',
  'umask 077',
  'printf "%s" "$WORKCELL_RELAY_CONFIG" > /run/workcell-relay/config.json'
].join(' && ')

const TRUST_EGRESS_AUTHORITY = `
if command -v update-ca-certificates >/dev/null 2>&1; then
  printf '%s\\n' "$WORKCELL_EGRESS_AUTHORITY" > /usr/local/share/ca-certificates/workcell-egress.crt
  update-ca-certificates --fresh >/dev/null
elif command -v update-ca-trust >/dev/null 2>&1; then
  printf '%s\\n' "$WORKCELL_EGRESS_AUTHORITY" > /etc/pki/ca-trust/source/anchors/workcell-egress.pem
  update-ca-trust extract
else
  echo 'The image has neither update-ca-certificates nor update-ca-trust.' >&2
  exit 1
fi
`

type RunAsRootParams = {
  command: string
  env: Readonly<Record<string, string>>
}

type ConfigureRelayParams = {
  relay: Dockerode.Container
  egressName: string
  registration: SandboxRegistration
  proxy: { host: string; port: number }
}

function isNotFound(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === NOT_FOUND_STATUS
  )
}

async function runAsRoot(
  container: Dockerode.Container,
  { command, env }: RunAsRootParams
) {
  const exec = await container.exec({
    Cmd: ['sh', '-c', command],
    Env: Object.entries(env).map(([name, value]) => {
      return `${name}=${value}`
    }),
    User: 'root',
    AttachStdout: true,
    AttachStderr: true,
    Tty: true
  })
  const output = await text(await exec.start({ Tty: true }))
  const { ExitCode } = await exec.inspect()

  if (ExitCode !== 0) {
    throw new Error(
      `The command as root exited with ${ExitCode}: ${output.trim()}`
    )
  }
}

async function ensureRelayImage(docker: Dockerode, relayImage: string) {
  try {
    await docker.getImage(relayImage).inspect()
  } catch (error) {
    if (!isNotFound(error)) {
      throw error
    }

    const progress = await docker.pull(relayImage)
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(progress, (failure) => {
        if (failure === null) {
          resolve(null)
        } else {
          reject(failure)
        }
      })
    })
  }
}

async function ensureRelayNetwork(docker: Dockerode) {
  const networks = await docker.listNetworks({
    filters: { name: [RELAY_NETWORK] }
  })

  if (
    !networks.some(({ Name }) => {
      return Name === RELAY_NETWORK
    })
  ) {
    await docker.createNetwork({ Name: RELAY_NETWORK })
  }
}

export async function createRelay(
  docker: Dockerode,
  { egressName, relayImage }: { egressName: string; relayImage: string }
) {
  await Promise.all([
    ensureRelayImage(docker, relayImage),
    ensureRelayNetwork(docker)
  ])
  try {
    await docker.createNetwork({
      Name: egressName,
      Internal: true,
      Labels: { [EGRESS_LABEL]: egressName }
    })
    const relay = await docker.createContainer({
      name: egressName,
      Image: relayImage,
      Cmd: [
        'node',
        '--input-type=module-typescript',
        '--eval',
        await readFile(RELAY_SOURCE_URL, 'utf8')
      ],
      Labels: { [EGRESS_LABEL]: egressName },
      HostConfig: {
        NetworkMode: RELAY_NETWORK,
        ExtraHosts: [`${HOST_GATEWAY_NAME}:host-gateway`],
        RestartPolicy: { Name: 'unless-stopped' },
        CapDrop: ['ALL'],
        CapAdd: ['NET_BIND_SERVICE']
      }
    })
    await docker.getNetwork(egressName).connect({ Container: relay.id })
    await relay.start()

    return relay
  } catch (error) {
    await removeRelay(docker, egressName)
    throw error
  }
}

export async function ensureRelayRunning(relay: Dockerode.Container) {
  const { State } = await relay.inspect()

  if (!State.Running) {
    await relay.start()
  }
}

export async function relayAddress(
  relay: Dockerode.Container,
  egressName: string
) {
  const { NetworkSettings } = await relay.inspect()
  const address = NetworkSettings.Networks[egressName]?.IPAddress

  if (address === undefined || address === '') {
    throw new Error(`The relay ${egressName} has no address on its network.`)
  }

  return address
}

export async function configureRelay({
  relay,
  egressName,
  registration,
  proxy
}: ConfigureRelayParams) {
  await runAsRoot(relay, {
    command: WRITE_RELAY_CONFIG,
    env: {
      WORKCELL_RELAY_CONFIG: JSON.stringify({
        sandboxAddress: await relayAddress(relay, egressName),
        proxyHost: proxy.host,
        proxyPort: proxy.port,
        serverName: registration.relay.serverName,
        authority: registration.relay.authority,
        certificate: registration.relay.certificate,
        privateKey: registration.relay.privateKey
      })
    }
  })
}

export async function trustEgressAuthority(
  sandbox: Dockerode.Container,
  certificateAuthority: string
) {
  await runAsRoot(sandbox, {
    command: TRUST_EGRESS_AUTHORITY,
    env: { WORKCELL_EGRESS_AUTHORITY: certificateAuthority }
  })
}

export async function removeRelay(docker: Dockerode, egressName: string) {
  try {
    await docker.getContainer(egressName).remove({ force: true, v: true })
  } catch (error) {
    if (!isNotFound(error)) {
      throw error
    }
  }

  try {
    await docker.getNetwork(egressName).remove()
  } catch (error) {
    if (!isNotFound(error)) {
      throw error
    }
  }
}
