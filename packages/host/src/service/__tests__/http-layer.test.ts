import { request, type IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { StartRefusalError } from '@workcell/core'
import { createLogger } from '#/logger.ts'
import { type HttpRoute, openHttpLayer } from '#/service/http-layer.ts'

const OK = 200

const FORBIDDEN = 403

const NOT_FOUND = 404

const FOREIGN_SITE = 'http://rebound.example'

const silentLogger = createLogger({ level: 'silent' })

function answering(path: `/${string}`): HttpRoute {
  return {
    path,
    fetch: () => {
      return new Response(path)
    }
  }
}

async function statusOf(url: URL, init?: RequestInit) {
  const response = await fetch(url, init)
  await response.body?.cancel()

  return response.status
}

function streamingForever(path: `/${string}`): HttpRoute {
  return {
    path,
    fetch: () => {
      const firstFrame = new TextEncoder().encode(': hello\n\n')

      return new Response(
        new ReadableStream({
          start: (controller) => {
            controller.enqueue(firstFrame)
          }
        }),
        {
          headers: { 'content-type': 'text/event-stream' }
        }
      )
    }
  }
}

function portOf(url: string | undefined) {
  return Number(new URL(url ?? '').port)
}

async function routeAnswering(url: URL) {
  const response = await fetch(url)

  return response.text()
}

async function statusUnderHost(url: URL, host: string) {
  const response = await new Promise<IncomingMessage>((resolve) => {
    request(url, { headers: { host } }, resolve).end()
  })
  response.resume()

  return response.statusCode
}

describe('the HTTP layer of the host', () => {
  it('keeps the routes of each listener out of reach of the other', async () => {
    await using layer = await openHttpLayer({
      operator: { port: 0, routes: [answering('/dashboard')] },
      webhook: { port: 0, routes: [answering('/webhooks/github')] },
      logger: silentLogger
    })
    const { operatorUrl, webhookUrl } = layer

    expect(await statusOf(new URL('/dashboard', operatorUrl))).toBe(OK)
    expect(await statusOf(new URL('/webhooks/github', webhookUrl))).toBe(OK)
    expect(await statusOf(new URL('/dashboard', webhookUrl))).toBe(NOT_FOUND)
    expect(await statusOf(new URL('/webhooks/github', operatorUrl))).toBe(
      NOT_FOUND
    )
  })

  it('hands each request to the route with the longest matching path', async () => {
    await using layer = await openHttpLayer({
      operator: {
        port: 0,
        routes: [
          answering('/'),
          answering('/harness'),
          answering('/harness/workers')
        ]
      },
      logger: silentLogger
    })
    const { operatorUrl } = layer

    expect(await routeAnswering(new URL('/assets/app.js', operatorUrl))).toBe(
      '/'
    )
    expect(
      await routeAnswering(new URL('/harness/workers/events', operatorUrl))
    ).toBe('/harness/workers')
    expect(await routeAnswering(new URL('/harness/bot/run', operatorUrl))).toBe(
      '/harness'
    )
    expect(await routeAnswering(new URL('/harnessed', operatorUrl))).toBe('/')
  })

  it('refuses two routes on the same path', async () => {
    await expect(
      openHttpLayer({
        operator: {
          port: 0,
          routes: [answering('/dashboard'), answering('/dashboard')]
        },
        logger: silentLogger
      })
    ).rejects.toThrow('/dashboard')
  })

  it('starts no webhook listener without a webhook route', async () => {
    await using layer = await openHttpLayer({
      operator: { port: 0, routes: [answering('/dashboard')] },
      webhook: { port: 0, routes: [] },
      logger: silentLogger
    })

    expect(layer.webhookUrl).toBeUndefined()
  })

  it('refuses a foreign host on the operator listener', async () => {
    await using layer = await openHttpLayer({
      operator: { port: 0, routes: [answering('/dashboard')] },
      logger: silentLogger
    })
    const dashboard = new URL('/dashboard', layer.operatorUrl)

    expect(await statusOf(dashboard)).toBe(OK)
    expect(await statusUnderHost(dashboard, new URL(FOREIGN_SITE).host)).toBe(
      FORBIDDEN
    )
  })

  it('lets any site deliver to the webhook listener', async () => {
    await using layer = await openHttpLayer({
      webhook: { port: 0, routes: [answering('/webhooks/github')] },
      logger: silentLogger
    })
    const delivery = new URL('/webhooks/github', layer.webhookUrl)

    expect(
      await statusOf(delivery, {
        method: 'POST',
        headers: { origin: FOREIGN_SITE }
      })
    ).toBe(OK)
    expect(await statusUnderHost(delivery, new URL(FOREIGN_SITE).host)).toBe(OK)
  })

  it('frees both ports on close, even with a stream left open', async () => {
    const first = await openHttpLayer({
      operator: { port: 0, routes: [streamingForever('/events')] },
      webhook: { port: 0, routes: [answering('/webhooks/github')] },
      logger: silentLogger
    })
    const operatorPort = portOf(first.operatorUrl)
    const webhookPort = portOf(first.webhookUrl)
    const stream = await fetch(new URL('/events', first.operatorUrl))
    await first[Symbol.asyncDispose]()
    await stream.body?.cancel().catch(() => {})

    await using second = await openHttpLayer({
      operator: { port: operatorPort, routes: [answering('/dashboard')] },
      webhook: { port: webhookPort, routes: [answering('/webhooks/github')] },
      logger: silentLogger
    })

    expect(await statusOf(new URL('/dashboard', second.operatorUrl))).toBe(OK)
    expect(await statusOf(new URL('/webhooks/github', second.webhookUrl))).toBe(
      OK
    )
  })

  it('refuses to start on a port already in use, and names it', async () => {
    await using holder = await openHttpLayer({
      operator: { port: 0, routes: [answering('/dashboard')] },
      logger: silentLogger
    })
    const takenPort = portOf(holder.operatorUrl)

    const refusal = openHttpLayer({
      operator: { port: takenPort, routes: [answering('/dashboard')] },
      logger: silentLogger
    })

    await expect(refusal).rejects.toBeInstanceOf(StartRefusalError)
    await expect(refusal).rejects.toThrow(String(takenPort))
  })

  it('frees the operator port when the webhook port is taken', async () => {
    await using holder = await openHttpLayer({
      webhook: { port: 0, routes: [answering('/webhooks/github')] },
      logger: silentLogger
    })
    const free = await openHttpLayer({
      operator: { port: 0, routes: [answering('/dashboard')] },
      logger: silentLogger
    })
    const operatorPort = portOf(free.operatorUrl)
    await free[Symbol.asyncDispose]()

    await expect(
      openHttpLayer({
        operator: { port: operatorPort, routes: [answering('/dashboard')] },
        webhook: {
          port: portOf(holder.webhookUrl),
          routes: [answering('/webhooks/github')]
        },
        logger: silentLogger
      })
    ).rejects.toBeInstanceOf(StartRefusalError)

    await using reopened = await openHttpLayer({
      operator: { port: operatorPort, routes: [answering('/dashboard')] },
      logger: silentLogger
    })

    expect(await statusOf(new URL('/dashboard', reopened.operatorUrl))).toBe(OK)
  })
})
