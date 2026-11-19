import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer as createHttpsServer, type Server } from 'node:https'
import { connect as netConnect } from 'node:net'
import { buffer, text } from 'node:stream/consumers'
import { connect, type TLSSocket } from 'node:tls'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock
} from 'vitest'
import {
  startCredentialProxy,
  type CredentialProxy,
  type SandboxRegistration
} from '#/sandbox/egress/credential-proxy.ts'
import {
  createCertificateAuthority,
  issueCertificate,
  type CertificateAuthority
} from '#/sandbox/egress/egress-certificates.ts'
import {
  bearerAuthorization,
  credentialPlaceholder,
  type SandboxEgress
} from '#/sandbox/egress/egress-policy.ts'

const EGRESS: SandboxEgress = {
  allowedHosts: ['api.forge.example', 'objects.cdn.example'],
  credentials: [
    {
      secret: 'FORGE_TOKEN',
      hostname: 'api.forge.example',
      header: 'authorization',
      value: bearerAuthorization
    }
  ]
}

const FIRST_TOKEN = 'forge-token-value-1'

const REFRESHED_TOKEN = 'forge-token-value-2'

const FORGE_PLACEHOLDER = credentialPlaceholder('FORGE_TOKEN')

const ABORTED_BODY = -1

const BODY_PAST_THE_INSPECTED_BOUND_BYTES = 3_145_728

const PLACEHOLDER_PAST_THE_INSPECTED_BOUND_BYTES = 2_097_152

const CONNECTION_CLOSED = 'connection closed'

const LOOPBACK_ADDRESS = '127.0.0.1'

const DUAL_STACK_LOOPBACK_NAME = 'localhost'

const CONCURRENT_REQUESTS = 32

const SANDBOX_ID = 'sandbox-container-1'

type TokenSource = { value: string | Error }

type TestLogger = { debug: Mock; warn: Mock }

type UpstreamRequest = {
  method: string
  url: string
  authorization: string | undefined
}

type SandboxRequestParams = {
  serverName: string
  head: string
  body?: string
  trusted?: string
}

const forgeToken: TokenSource = { value: FIRST_TOKEN }

const upstreamDialing = { host: LOOPBACK_ADDRESS }
const upstreamRequests: UpstreamRequest[] = []
const upstreamBodyBytes: number[] = []
const upstreams: Server[] = []
let logger: TestLogger
let upstreamAuthority: CertificateAuthority
let proxy: CredentialProxy

async function listenLocally(server: Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  if (address === null || typeof address === 'string') {
    throw new Error('The test upstream listens on no TCP port.')
  }

  return address.port
}

async function bodyBytes(request: IncomingMessage) {
  try {
    const bytes = await buffer(request)

    return bytes.length
  } catch {
    return ABORTED_BODY
  }
}

async function record(
  request: IncomingMessage,
  response: ServerResponse,
  answer: string
) {
  upstreamRequests.push({
    method: request.method ?? '',
    url: request.url ?? '',
    authorization: request.headers.authorization
  })
  upstreamBodyBytes.push(await bodyBytes(request))
  response.setHeader('content-type', 'application/json')
  response.end(answer)
}

async function startUpstream(hostname: string, answer: string) {
  const certificate = await issueCertificate(upstreamAuthority, {
    commonName: hostname,
    dnsNames: [hostname],
    usage: 'server'
  })
  const server = createHttpsServer(
    { cert: certificate.certificate, key: certificate.privateKey },
    (request, response) => {
      void record(request, response, answer)
    }
  )
  upstreams.push(server)

  return [hostname, await listenLocally(server)] as const
}

function connectAsRelay(registration: SandboxRegistration) {
  return new Promise<TLSSocket>((resolve, reject) => {
    const socket = connect({
      host: '127.0.0.1',
      port: proxy.port,
      servername: registration.relay.serverName,
      ca: registration.relay.authority,
      cert: registration.relay.certificate,
      key: registration.relay.privateKey
    })
    socket.once('secureConnect', () => {
      resolve(socket)
    })
    socket.once('error', reject)
  })
}

async function sandboxRequest(
  registration: SandboxRegistration,
  {
    serverName,
    head,
    body = '',
    trusted = registration.certificateAuthority
  }: SandboxRequestParams
) {
  const relay = await connectAsRelay(registration)
  const socket = connect({ socket: relay, servername: serverName, ca: trusted })
  socket.write(`${head}\r\nConnection: close\r\n\r\n${body}`)
  const answer = await text(socket)

  if (answer === '') {
    return CONNECTION_CLOSED
  }

  const [statusLine = '', answerBody = ''] = answer.split(/\r\n\r\n/u)

  return { status: Number(statusLine.split(' ')[1]), body: answerBody }
}

async function createUpstreamAuthority() {
  upstreamAuthority = await createCertificateAuthority(
    'Test upstream authority'
  )
}

async function startProxy() {
  upstreamRequests.length = 0
  upstreamBodyBytes.length = 0
  forgeToken.value = FIRST_TOKEN
  upstreamDialing.host = LOOPBACK_ADDRESS
  logger = { debug: vi.fn(), warn: vi.fn() }
  const ports = new Map([
    await startUpstream('api.forge.example', '{"login":"worker"}'),
    await startUpstream('objects.cdn.example', '{"object":"archive"}')
  ])
  proxy = await startCredentialProxy({
    secrets: async (name) => {
      if (forgeToken.value instanceof Error) {
        throw forgeToken.value
      }

      return name === 'FORGE_TOKEN' ? forgeToken.value : ''
    },
    logger,
    upstream: {
      connect: ({ host }) => {
        const port = ports.get(host)

        if (port === undefined) {
          throw new Error(`The test has no upstream for ${host}.`)
        }

        return netConnect({
          host: upstreamDialing.host,
          port,
          autoSelectFamily: true
        })
      },
      certificateAuthorities: [upstreamAuthority.certificate]
    }
  })
}

async function stopProxy() {
  await proxy.close()

  for (const server of upstreams.splice(0)) {
    server.closeAllConnections()
    server.close()
  }
}

describe('the credential proxy on a request', () => {
  beforeAll(createUpstreamAuthority)

  beforeEach(startProxy)

  afterEach(stopProxy)

  it('fills the real credential in the header of a mapped host', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })

    const answer = await sandboxRequest(registration, {
      serverName: 'api.forge.example',
      head: `GET /user HTTP/1.1\r\nHost: api.forge.example\r\nAuthorization: token ${FORGE_PLACEHOLDER}`
    })

    expect({ answer, upstreamRequests }).toStrictEqual({
      answer: { status: 200, body: '{"login":"worker"}' },
      upstreamRequests: [
        { method: 'GET', url: '/user', authorization: `Bearer ${FIRST_TOKEN}` }
      ]
    })
  })

  it('refuses a placeholder outside the header, and logs the refusal without the secret', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })
    const reason =
      'The request carries the placeholder of FORGE_TOKEN outside the header it fills.'

    const answer = await sandboxRequest(registration, {
      serverName: 'api.forge.example',
      head: `GET /search?q=${FORGE_PLACEHOLDER} HTTP/1.1\r\nHost: api.forge.example`
    })

    expect({
      answer,
      upstreamRequests,
      logged: logger.warn.mock.calls
    }).toStrictEqual({
      answer: { status: 403, body: `${reason}\n` },
      upstreamRequests: [],
      logged: [
        [
          {
            sandboxId: registration.id,
            host: 'api.forge.example',
            method: 'GET',
            reason
          },
          'egress request refused'
        ]
      ]
    })
  })

  it('passes an allowed host outside the credential map through, without decrypting it', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })

    const answer = await sandboxRequest(registration, {
      serverName: 'objects.cdn.example',
      head: 'GET /archive.tgz HTTP/1.1\r\nHost: objects.cdn.example\r\nAuthorization: Bearer agent-own-value',
      trusted: upstreamAuthority.certificate
    })

    expect({ answer, upstreamRequests }).toStrictEqual({
      answer: { status: 200, body: '{"object":"archive"}' },
      upstreamRequests: [
        {
          method: 'GET',
          url: '/archive.tgz',
          authorization: 'Bearer agent-own-value'
        }
      ]
    })
  })

  it('reads the secret again for each request, so a refreshed token applies at once', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })
    const request = {
      serverName: 'api.forge.example',
      head: 'GET /user HTTP/1.1\r\nHost: api.forge.example'
    }

    await sandboxRequest(registration, request)
    forgeToken.value = REFRESHED_TOKEN
    await sandboxRequest(registration, request)

    expect(
      upstreamRequests.map(({ authorization }) => {
        return authorization
      })
    ).toStrictEqual([`Bearer ${FIRST_TOKEN}`, `Bearer ${REFRESHED_TOKEN}`])
  })

  it('refuses a placeholder in the body before the request reaches the upstream', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })
    const body = JSON.stringify({
      query: `{ search(text: "${FORGE_PLACEHOLDER}") }`
    })

    const answer = await sandboxRequest(registration, {
      serverName: 'api.forge.example',
      head: `POST /graphql HTTP/1.1\r\nHost: api.forge.example\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}`,
      body
    })

    expect({ answer, upstreamRequests }).toStrictEqual({
      answer: {
        status: 403,
        body: 'The request carries the placeholder of FORGE_TOKEN in its body.\n'
      },
      upstreamRequests: []
    })
  })

  it('streams a body past the inspected bound to the upstream, whole', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })
    const body = 'x'.repeat(BODY_PAST_THE_INSPECTED_BOUND_BYTES)

    const answer = await sandboxRequest(registration, {
      serverName: 'api.forge.example',
      head: `POST /upload HTTP/1.1\r\nHost: api.forge.example\r\nContent-Length: ${body.length}`,
      body
    })

    expect({ answer, upstreamBodyBytes }).toStrictEqual({
      answer: { status: 200, body: '{"login":"worker"}' },
      upstreamBodyBytes: [BODY_PAST_THE_INSPECTED_BOUND_BYTES]
    })
  })

  it('cuts a streamed body at a placeholder past the inspected bound', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })
    const body = `${'x'.repeat(PLACEHOLDER_PAST_THE_INSPECTED_BOUND_BYTES)}${FORGE_PLACEHOLDER}`

    const answer = await sandboxRequest(registration, {
      serverName: 'api.forge.example',
      head: `POST /upload HTTP/1.1\r\nHost: api.forge.example\r\nContent-Length: ${body.length}`,
      body
    })

    await expect
      .poll(() => {
        return upstreamBodyBytes
      })
      .toStrictEqual([ABORTED_BODY])
    expect(answer).toStrictEqual({
      status: 403,
      body: 'The request carries the placeholder of FORGE_TOKEN in its body.\n'
    })
  })

  it('answers 502 when the secret lookup fails, and logs the secret name only', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })
    forgeToken.value = new Error('The store refused FORGE_TOKEN.')

    const answer = await sandboxRequest(registration, {
      serverName: 'api.forge.example',
      head: 'GET /user HTTP/1.1\r\nHost: api.forge.example'
    })

    expect({
      answer,
      upstreamRequests,
      logged: logger.warn.mock.calls
    }).toStrictEqual({
      answer: { status: 502, body: '' },
      upstreamRequests: [],
      logged: [
        [
          {
            sandboxId: registration.id,
            host: 'api.forge.example',
            method: 'GET',
            secret: 'FORGE_TOKEN',
            error: 'The store refused FORGE_TOKEN.'
          },
          'egress secret lookup failed'
        ]
      ]
    })
  })

  it('fills the header while the upstream connection falls back from IPv6 to IPv4', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })
    upstreamDialing.host = DUAL_STACK_LOOPBACK_NAME

    const answers = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, async () => {
        return sandboxRequest(registration, {
          serverName: 'api.forge.example',
          head: 'GET /user HTTP/1.1\r\nHost: api.forge.example'
        })
      })
    )

    expect(answers).toStrictEqual(
      Array.from({ length: CONCURRENT_REQUESTS }, () => {
        return { status: 200, body: '{"login":"worker"}' }
      })
    )
  })
})

describe('the credential proxy on a connection', () => {
  beforeAll(createUpstreamAuthority)

  beforeEach(startProxy)

  afterEach(stopProxy)

  it('closes the connection to a host outside the allowlist', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })

    expect(
      await sandboxRequest(registration, {
        serverName: 'attacker.example',
        head: 'GET / HTTP/1.1\r\nHost: attacker.example'
      })
    ).toBe(CONNECTION_CLOSED)
  })

  it('refuses a relay once its sandbox is forgotten', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })
    proxy.forgetSandbox(registration.id)

    expect(
      await sandboxRequest(registration, {
        serverName: 'api.forge.example',
        head: 'GET /user HTTP/1.1\r\nHost: api.forge.example'
      })
    ).toBe(CONNECTION_CLOSED)
  })

  it('refuses a relay whose certificate another authority issued', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })
    const forged = await issueCertificate(upstreamAuthority, {
      commonName: registration.id,
      dnsNames: [],
      usage: 'client'
    })

    const relay = await connectAsRelay({
      ...registration,
      relay: {
        ...registration.relay,
        certificate: forged.certificate,
        privateKey: forged.privateKey
      }
    })

    expect(await text(relay)).toBe('')
  })

  it('closes a relayed connection that does not open with TLS', async () => {
    const registration = await proxy.registerSandbox({
      id: SANDBOX_ID,
      egress: EGRESS
    })
    const relay = await connectAsRelay(registration)
    relay.write('GET / HTTP/1.1\r\nHost: api.forge.example\r\n\r\n')

    expect(await text(relay)).toBe('')
  })
})
