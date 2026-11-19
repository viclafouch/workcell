import { once } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import {
  longestPlaceholderLength,
  secretCarriedIn,
  type SandboxEgress
} from './egress-policy.ts'

const INSPECTED_BODY_BYTES = 1_048_576

type RelayBodyParams = {
  request: IncomingMessage
  egress: SandboxEgress
  openUpstream: () => ClientRequest
}

type HeldBody = {
  chunks: Buffer[]
  bytes: number
  upstream: ClientRequest | null
}

function lastCharacters(text: string, count: number) {
  return text.slice(Math.max(0, text.length - count))
}

async function passOn(
  body: HeldBody,
  chunk: Buffer,
  openUpstream: () => ClientRequest
) {
  if (body.upstream !== null) {
    if (!body.upstream.write(chunk)) {
      await once(body.upstream, 'drain')
    }

    return
  }

  body.chunks.push(chunk)
  body.bytes += chunk.length

  if (body.bytes > INSPECTED_BODY_BYTES) {
    body.upstream = openUpstream()
    body.upstream.write(Buffer.concat(body.chunks.splice(0)))
  }
}

export async function relayBody({
  request,
  egress,
  openUpstream
}: RelayBodyParams) {
  const overlap = longestPlaceholderLength(egress) - 1
  const body: HeldBody = { chunks: [], bytes: 0, upstream: null }
  let tail = ''

  try {
    for await (const chunk of request) {
      if (!Buffer.isBuffer(chunk)) {
        continue
      }

      const scanned = tail + chunk.toString('latin1')
      const carriedSecret = secretCarriedIn(egress, scanned)

      if (carriedSecret !== undefined) {
        body.upstream?.destroy()

        return carriedSecret
      }

      tail = lastCharacters(scanned, overlap)
      await passOn(body, chunk, openUpstream)
    }
  } catch (error) {
    body.upstream?.destroy()
    throw error
  }

  const upstream = body.upstream ?? openUpstream()
  upstream.end(Buffer.concat(body.chunks))

  return null
}
