import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi
} from 'vitest'
import { createPacedFetch } from './paced-fetch.ts'

const API_URL = 'https://api.example.test'

const REQUESTS_PER_MINUTE = 3

const BUDGET_EXCEEDED =
  'The budget of the example reads is 3 Example requests a minute'

let requests: number

let answers: PromiseWithResolvers<null>

const network = setupServer(
  http.get(`${API_URL}/echo/:name`, async ({ params }) => {
    requests += 1
    await answers.promise

    return HttpResponse.text(String(params.name))
  }),
  http.get(`${API_URL}/broken`, () => {
    requests += 1

    return new HttpResponse(null, { status: 502 })
  })
)

function neverRateLimited() {
  return false
}

function noResetHeader(): undefined {}

function openPacedFetch() {
  return createPacedFetch({
    apiName: 'Example',
    subject: 'the example reads',
    requestsPerMinute: REQUESTS_PER_MINUTE,
    headers: {},
    isRateLimited: neverRateLimited,
    rateLimitResetAt: noResetHeader
  })
}

describe('the paced fetch', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(() => {
    requests = 0
    answers = Promise.withResolvers()
  })

  afterAll(() => {
    network.close()
  })

  it('gives each of two calls at once the answer of its own call', async () => {
    using paced = openPacedFetch()

    const calls = Promise.all([
      paced.pacedFetch(`${API_URL}/echo/first`),
      paced.pacedFetch(`${API_URL}/echo/second`)
    ])
    await vi.waitFor(() => {
      expect(requests).toBe(2)
    })
    answers.resolve(null)

    await expect(calls).resolves.toStrictEqual([
      { status: 200, text: 'first' },
      { status: 200, text: 'second' }
    ])
  })

  it('counts each retry of a server error in the budget of the minute, then stops', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    using paced = openPacedFetch()

    await Promise.all([
      expect(paced.pacedFetch(`${API_URL}/broken`)).rejects.toThrow(
        BUDGET_EXCEEDED
      ),
      vi.runAllTimersAsync()
    ])

    expect(requests).toBe(REQUESTS_PER_MINUTE)
    await expect(paced.pacedFetch(`${API_URL}/broken`)).rejects.toThrow(
      BUDGET_EXCEEDED
    )
    expect(requests).toBe(REQUESTS_PER_MINUTE)
  })
})
