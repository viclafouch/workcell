import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http'
import {
  createSecureContext,
  createServer as createTlsServer,
  TLSSocket,
  type SecureContext
} from 'node:tls'
import { getExtensionData, readTlsClientHello } from 'read-tls-client-hello'
import {
  createCertificateAuthority,
  issueCertificate,
  type CertificateAuthority
} from './egress-certificates.ts'
import {
  decideEgressConnection,
  decideEgressRequest,
  type CredentialRule,
  type SandboxEgress
} from './egress-policy.ts'
import { relayBody } from './request-body.ts'
import {
  connectDirectly,
  HTTPS_PORT,
  openUpstream,
  type UpstreamOptions
} from './upstream.ts'

const PROXY_SERVER_NAME = 'workcell-credential-proxy'
const LOOPBACK = '127.0.0.1'
const CLIENT_HELLO_TIMEOUT_MS = 10_000
const FORBIDDEN_STATUS = 403
const BAD_GATEWAY_STATUS = 502
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key'
])
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'upgrade',
  'expect'
])

type LogLine = (details: Record<string, unknown>, message: string) => void

export type CredentialProxyParams = {
  secrets: (name: string) => Promise<string>
  logger: { debug: LogLine; warn: LogLine }
  host?: string
  upstream?: UpstreamOptions
}

export type SandboxRegistration = {
  id: string
  certificateAuthority: string
  relay: {
    serverName: string
    authority: string
    certificate: string
    privateKey: string
  }
}

export type RegisterSandboxParams = { id: string; egress: SandboxEgress }

export type CredentialProxy = {
  port: number
  registerSandbox: (
    params: RegisterSandboxParams
  ) => Promise<SandboxRegistration>
  forgetSandbox: (id: string) => void
  close: () => Promise<void>
}

type RegisteredSandbox = {
  egress: SandboxEgress
  authority: CertificateAuthority
  hostContexts: Map<string, Promise<SecureContext>>
}

type TerminatedConnection = { sandboxId: string; serverName: string }

type ProxyState = Pick<CredentialProxyParams, 'secrets' | 'logger'> & {
  upstream: Parameters<typeof openUpstream>[0]['upstream']
  sandboxes: Map<string, RegisteredSandbox>
  terminated: WeakMap<TLSSocket, TerminatedConnection>
  http: HttpServer
}

type RequestDetails = {
  sandboxId: string
  host: string
  method: string | undefined
}

type Exchange = { request: IncomingMessage; response: ServerResponse }

type Refusal = { details: RequestDetails; reason: string }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function answerBadGateway(response: ServerResponse) {
  if (response.headersSent) {
    response.destroy()
  } else {
    response.writeHead(BAD_GATEWAY_STATUS, { 'content-length': 0 }).end()
  }
}

function upstreamHeaders(
  incoming: IncomingMessage['headers']
): OutgoingHttpHeaders {
  return Object.fromEntries(
    Object.entries(incoming).filter(([name]) => {
      return !CREDENTIAL_HEADERS.has(name) && !HOP_BY_HOP_HEADERS.has(name)
    })
  )
}

function refuse(
  { logger }: Pick<ProxyState, 'logger'>,
  response: ServerResponse,
  { details, reason }: Refusal
) {
  logger.warn({ ...details, reason }, 'egress request refused')

  if (response.headersSent) {
    response.destroy()

    return
  }

  const message = `${reason}\n`
  response
    .writeHead(FORBIDDEN_STATUS, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': Buffer.byteLength(message)
    })
    .end(message)
}

async function filledHeaders(
  state: Pick<ProxyState, 'secrets' | 'logger'>,
  { request, response }: Exchange,
  { details, rule }: { details: RequestDetails; rule: CredentialRule | null }
) {
  const headers = upstreamHeaders(request.headers)

  if (rule === null) {
    return headers
  }

  try {
    headers[rule.header] = rule.value(await state.secrets(rule.secret))

    return headers
  } catch (error) {
    state.logger.warn(
      { ...details, secret: rule.secret, error: errorMessage(error) },
      'egress secret lookup failed'
    )
    answerBadGateway(response)

    return null
  }
}

function openAnsweringUpstream(
  state: ProxyState,
  { request, response }: Exchange,
  {
    details,
    headers
  }: { details: RequestDetails; headers: OutgoingHttpHeaders }
) {
  const upstream = openUpstream({
    request,
    serverName: details.host,
    headers,
    upstream: state.upstream
  })
  upstream.on('response', (answer) => {
    response.writeHead(answer.statusCode ?? BAD_GATEWAY_STATUS, answer.headers)
    answer.pipe(response)
  })
  upstream.on('error', (error) => {
    state.logger.warn(
      { ...details, error: error.message },
      'egress upstream failed'
    )
    answerBadGateway(response)
  })

  return upstream
}

async function forward(
  state: ProxyState,
  exchange: Exchange,
  { sandboxId, serverName }: TerminatedConnection
) {
  const { request, response } = exchange
  const sandbox = state.sandboxes.get(sandboxId)

  if (sandbox === undefined) {
    response.destroy()

    return
  }

  const details = { sandboxId, host: serverName, method: request.method }
  const decision = decideEgressRequest(sandbox.egress, {
    method: request.method ?? '',
    serverName,
    url: request.url ?? '/',
    headers: request.headers
  })

  if (decision.action === 'refuse') {
    refuse(state, response, { details, reason: decision.reason })

    return
  }

  const headers = await filledHeaders(state, exchange, {
    details,
    rule: decision.action === 'fill' ? decision.rule : null
  })

  if (headers === null) {
    return
  }

  const refusedSecret = await relayBody({
    request,
    egress: sandbox.egress,
    openUpstream: () => {
      return openAnsweringUpstream(state, exchange, { details, headers })
    }
  })

  if (refusedSecret !== null) {
    refuse(state, response, {
      details,
      reason: `The request carries the placeholder of ${refusedSecret} in its body.`
    })
  }
}

async function serve(
  state: ProxyState,
  exchange: Exchange,
  connection: TerminatedConnection
) {
  try {
    await forward(state, exchange, connection)
  } catch (error) {
    state.logger.warn(
      {
        sandboxId: connection.sandboxId,
        host: connection.serverName,
        error: errorMessage(error)
      },
      'egress request failed'
    )
    answerBadGateway(exchange.response)
  }
}

async function hostContext(sandbox: RegisteredSandbox, serverName: string) {
  const cached = sandbox.hostContexts.get(serverName)

  if (cached !== undefined) {
    return cached
  }

  const issuing = issueCertificate(sandbox.authority, {
    commonName: serverName,
    dnsNames: [serverName],
    usage: 'server'
  })
  const context = (async () => {
    try {
      const { certificate, privateKey } = await issuing

      return createSecureContext({ cert: certificate, key: privateKey })
    } catch (error) {
      sandbox.hostContexts.delete(serverName)
      throw error
    }
  })()
  sandbox.hostContexts.set(serverName, context)

  return context
}

async function readServerName(socket: TLSSocket) {
  socket.setTimeout(CLIENT_HELLO_TIMEOUT_MS, () => {
    socket.destroy()
  })

  try {
    const hello = await readTlsClientHello(socket)

    return getExtensionData(hello, 'sni')?.serverName ?? null
  } catch {
    return null
  } finally {
    socket.setTimeout(0)
  }
}

function passThrough(state: ProxyState, socket: TLSSocket, serverName: string) {
  const upstream = state.upstream.connect({
    host: serverName,
    port: HTTPS_PORT
  })
  upstream.on('error', () => {
    socket.destroy()
  })
  socket.on('error', () => {
    upstream.destroy()
  })
  socket.pipe(upstream).pipe(socket)
}

function sandboxOf(state: ProxyState, socket: TLSSocket) {
  const commonName = socket.getPeerCertificate().subject?.CN

  if (typeof commonName !== 'string') {
    return null
  }

  const sandbox = state.sandboxes.get(commonName)

  return sandbox === undefined ? null : { sandboxId: commonName, sandbox }
}

async function relay(state: ProxyState, socket: TLSSocket) {
  const registered = sandboxOf(state, socket)
  const serverName = registered === null ? null : await readServerName(socket)

  if (registered === null || serverName === null) {
    socket.destroy()

    return
  }

  const { sandboxId, sandbox } = registered
  const connection = decideEgressConnection(sandbox.egress, serverName)

  if (connection === 'refuse') {
    socket.destroy()

    return
  }

  if (connection === 'pass') {
    passThrough(state, socket, serverName)

    return
  }

  const secureSocket = new TLSSocket(socket, {
    isServer: true,
    secureContext: await hostContext(sandbox, serverName),
    ALPNProtocols: ['http/1.1']
  })
  state.terminated.set(secureSocket, { sandboxId, serverName })
  state.http.emit('connection', secureSocket)
}

async function serveRelay(state: ProxyState, socket: TLSSocket) {
  try {
    await relay(state, socket)
  } catch (error) {
    state.logger.warn({ error: errorMessage(error) }, 'egress relay failed')
    socket.destroy()
  }
}

function listeningPort(address: ReturnType<HttpServer['address']>) {
  if (address === null || typeof address === 'string') {
    throw new Error('The credential proxy listens on no TCP port.')
  }

  return address.port
}

function createProxyHttpServer(state: Omit<ProxyState, 'http'>) {
  const proxyState: ProxyState = {
    ...state,
    http: createHttpServer((request, response) => {
      const connection =
        request.socket instanceof TLSSocket
          ? state.terminated.get(request.socket)
          : undefined

      if (connection === undefined) {
        response.destroy()

        return
      }

      void serve(proxyState, { request, response }, connection)
    })
  }

  return proxyState
}

export async function startCredentialProxy({
  secrets,
  logger,
  host = LOOPBACK,
  upstream: { connect = connectDirectly, certificateAuthorities } = {}
}: CredentialProxyParams): Promise<CredentialProxy> {
  const relayAuthority = await createCertificateAuthority(
    'Workcell relay authority'
  )
  const listenerCertificate = await issueCertificate(relayAuthority, {
    commonName: PROXY_SERVER_NAME,
    dnsNames: [PROXY_SERVER_NAME],
    usage: 'server'
  })
  const relaySockets = new Set<TLSSocket>()
  const state = createProxyHttpServer({
    secrets,
    logger,
    upstream: { connect, certificateAuthorities },
    sandboxes: new Map(),
    terminated: new WeakMap()
  })
  const listener = createTlsServer(
    {
      cert: listenerCertificate.certificate,
      key: listenerCertificate.privateKey,
      ca: [relayAuthority.certificate],
      requestCert: true,
      rejectUnauthorized: true
    },
    (socket) => {
      relaySockets.add(socket)
      socket.once('close', () => {
        relaySockets.delete(socket)
      })
      void serveRelay(state, socket)
    }
  )
  listener.listen(0, host)
  await once(listener, 'listening')

  return {
    port: listeningPort(listener.address()),
    registerSandbox: async ({ id, egress }) => {
      const [authority, relayCertificate] = await Promise.all([
        createCertificateAuthority(`Workcell sandbox ${randomUUID()}`),
        issueCertificate(relayAuthority, {
          commonName: id,
          dnsNames: [],
          usage: 'client'
        })
      ])
      state.sandboxes.set(id, { egress, authority, hostContexts: new Map() })

      return {
        id,
        certificateAuthority: authority.certificate,
        relay: {
          serverName: PROXY_SERVER_NAME,
          authority: relayAuthority.certificate,
          certificate: relayCertificate.certificate,
          privateKey: relayCertificate.privateKey
        }
      }
    },
    forgetSandbox: (id) => {
      state.sandboxes.delete(id)
    },
    close: async () => {
      listener.close()

      for (const socket of relaySockets) {
        socket.destroy()
      }

      await once(listener, 'close')
    }
  }
}
