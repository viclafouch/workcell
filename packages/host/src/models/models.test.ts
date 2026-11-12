import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { chat, type AnyTextAdapter, type StreamChunk } from '@tanstack/ai'
import { gatewayUrlSchema, toModelConfig, type ModelRole } from './config.ts'
import { createModels } from './models.ts'

const MODEL_KEY = 'sk-model-key'

const UNAUTHORIZED = 401

const MODEL_IDS = {
  orchestrator: 'gpt-6-luna',
  worker: 'claude-opus-5-5',
  compaction: 'claude-haiku-5-5',
  memory: 'claude-haiku-5-5',
  grader: 'kimi-k3'
}

const requestBody = z.looseObject({ model: z.string() })

const runErrorSource = z.looseObject({
  type: z.literal('RUN_ERROR'),
  metadata: z.looseObject({
    tanstack: z.looseObject({
      source: z.looseObject({ provider: z.string(), model: z.string() })
    })
  })
})

type GatewayRequest = {
  endpoint: string
  apiKey: string | undefined
  authorization: string | undefined
  tag: string | undefined
  model: string
}

function readHeader(header: string | string[] | undefined) {
  return Array.isArray(header) ? header.join(',') : header
}

async function startGateway() {
  const requests: GatewayRequest[] = []
  const server = createServer((request, response) => {
    let body = ''

    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const { model } = requestBody.parse(JSON.parse(body))

      requests.push({
        endpoint: new URL(request.url ?? '/', 'http://gateway').pathname,
        apiKey: readHeader(request.headers['x-api-key']),
        authorization: readHeader(request.headers.authorization),
        tag: readHeader(request.headers['x-cost-tag']),
        model
      })
      response.writeHead(UNAUTHORIZED, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid key' }
        })
      )
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = z.custom<AddressInfo>().parse(server.address())
  onTestFinished(() => {
    server.close()
  })

  return { url: `http://127.0.0.1:${port}`, requests }
}

async function runOnePrompt(adapter: AnyTextAdapter) {
  const chunks: StreamChunk[] = []

  for await (const chunk of chat({
    adapter,
    messages: [{ role: 'user', content: 'Hi' }],
    threadId: 'thread-1',
    debug: false
  })) {
    chunks.push(chunk)
  }

  return chunks
}

function readErrorSources(chunks: StreamChunk[]) {
  return chunks.flatMap((chunk) => {
    const runError = runErrorSource.safeParse(chunk)

    return runError.success ? [runError.data.metadata.tanstack.source] : []
  })
}

function costTag(role: ModelRole) {
  return { 'x-cost-tag': `acme:${role}` }
}

function createGatewayModels(gatewayUrl: string) {
  return createModels({
    modelKey: MODEL_KEY,
    config: { modelIds: MODEL_IDS, gatewayUrl },
    roleHeaders: costTag
  })
}

describe('createModels on a model gateway', () => {
  it('sends a Claude role to the Messages API, with the model key and the headers of its role', async () => {
    const gateway = await startGateway()
    const models = createGatewayModels(gateway.url)

    await runOnePrompt(models.textAdapter('worker'))

    expect(gateway.requests).toStrictEqual([
      {
        endpoint: '/v1/messages',
        apiKey: MODEL_KEY,
        authorization: undefined,
        tag: 'acme:worker',
        model: 'claude-opus-5-5'
      }
    ])
  })

  it('sends a GPT role to the Responses API', async () => {
    const gateway = await startGateway()
    const models = createGatewayModels(gateway.url)

    await runOnePrompt(models.textAdapter('orchestrator'))

    expect(gateway.requests).toStrictEqual([
      {
        endpoint: '/v1/responses',
        apiKey: undefined,
        authorization: `Bearer ${MODEL_KEY}`,
        tag: 'acme:orchestrator',
        model: 'gpt-6-luna'
      }
    ])
  })

  it('sends any other model to the Chat Completions API', async () => {
    const gateway = await startGateway()
    const models = createGatewayModels(gateway.url)

    await runOnePrompt(models.textAdapter('grader'))

    expect(gateway.requests).toStrictEqual([
      {
        endpoint: '/v1/chat/completions',
        apiKey: undefined,
        authorization: `Bearer ${MODEL_KEY}`,
        tag: 'acme:grader',
        model: 'kimi-k3'
      }
    ])
  })

  it('names the gateway and the model in a model error, never the key', async () => {
    const gateway = await startGateway()
    const models = createGatewayModels(gateway.url)

    const chunks = await runOnePrompt(models.textAdapter('worker'))

    expect(readErrorSources(chunks)).toMatchObject([
      { provider: 'model-gateway', model: 'claude-opus-5-5' }
    ])
    expect(JSON.stringify(chunks)).not.toContain(MODEL_KEY)
  })

  it('sums up the gateway origin and the provider, API and model of each role, with no key', () => {
    const models = createGatewayModels('https://llm.example.com/proxy')

    expect(models.summary).toStrictEqual({
      gateway: 'https://llm.example.com',
      models: {
        orchestrator: {
          provider: 'openai',
          api: 'openai-responses',
          model: 'gpt-6-luna'
        },
        worker: {
          provider: 'model-gateway',
          api: 'anthropic-messages',
          model: 'claude-opus-5-5'
        },
        compaction: {
          provider: 'model-gateway',
          api: 'anthropic-messages',
          model: 'claude-haiku-5-5'
        },
        memory: {
          provider: 'model-gateway',
          api: 'anthropic-messages',
          model: 'claude-haiku-5-5'
        },
        grader: {
          provider: 'model-gateway',
          api: 'openai-completions',
          model: 'kimi-k3'
        }
      }
    })
  })
})

describe('toModelConfig', () => {
  it('gives each role the default model, unless the role sets its own', () => {
    expect(
      toModelConfig({
        defaultModelId: 'claude-haiku-5-5',
        roleModelIds: { worker: 'kimi-k3', grader: undefined },
        gatewayUrl: 'https://llm.example.com'
      })
    ).toStrictEqual({
      modelIds: {
        orchestrator: 'claude-haiku-5-5',
        worker: 'kimi-k3',
        compaction: 'claude-haiku-5-5',
        memory: 'claude-haiku-5-5',
        grader: 'claude-haiku-5-5'
      },
      gatewayUrl: 'https://llm.example.com'
    })
  })
})

describe('gatewayUrlSchema', () => {
  it('refuses a gateway URL that carries credentials, and keeps them out of the error', () => {
    const result = gatewayUrlSchema.safeParse(
      'https://agent:gateway-password@llm.example.com'
    )

    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error)).not.toContain('gateway-password')
  })

  it('accepts a gateway URL with no credentials', () => {
    expect(gatewayUrlSchema.parse('https://llm.example.com/anthropic')).toBe(
      'https://llm.example.com/anthropic'
    )
  })
})
