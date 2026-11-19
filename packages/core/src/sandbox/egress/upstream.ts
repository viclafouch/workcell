import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

export const HTTPS_PORT = 443

export type UpstreamTarget = { host: string; port: number }

export type UpstreamOptions = {
  connect?: (target: UpstreamTarget) => Socket
  certificateAuthorities?: readonly string[]
}

type OpenUpstreamParams = {
  request: IncomingMessage
  serverName: string
  headers: OutgoingHttpHeaders
  upstream: Required<Pick<UpstreamOptions, 'connect'>> &
    Pick<UpstreamOptions, 'certificateAuthorities'>
}

export function connectDirectly({ host, port }: UpstreamTarget) {
  return netConnect({ host, port })
}

export function openUpstream({
  request,
  serverName,
  headers,
  upstream: { connect, certificateAuthorities }
}: OpenUpstreamParams) {
  return httpsRequest({
    host: serverName,
    port: HTTPS_PORT,
    servername: serverName,
    method: request.method,
    path: request.url,
    headers,
    createConnection: (_options, onCreate) => {
      const socket = connect({ host: serverName, port: HTTPS_PORT })
      socket.once('error', onCreate)
      socket.once('connect', () => {
        socket.off('error', onCreate)
        onCreate(
          null,
          tlsConnect({
            socket,
            servername: serverName,
            ca:
              certificateAuthorities === undefined
                ? undefined
                : [...certificateAuthorities],
            ALPNProtocols: ['http/1.1']
          })
        )
      })

      return null
    }
  })
}
