import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { npmPackageProbe } from '#/machine-check/secret-probes.ts'

const NPM_TOKEN = 'npm_acme'

function answerTo(token: string, request: Request) {
  return request.headers.get('authorization') === `Bearer ${token}`
    ? HttpResponse.json({})
    : HttpResponse.json({}, { status: 401 })
}

const network = setupServer(
  http.get('https://registry.npmjs.org/@acme%2Fconfig', ({ request }) => {
    return answerTo(NPM_TOKEN, request)
  })
)

describe('the npm package probe', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  afterAll(() => {
    network.close()
  })

  it('reads a private package of the npm scope with the token', async () => {
    const probe = npmPackageProbe('@acme/config')

    expect(probe.service).toBe('npm, on the @acme scope,')
    await expect(probe.probe(NPM_TOKEN)).resolves.toBe('accepted')
    await expect(probe.probe('npm_other')).resolves.toBe('refused')
  })
})
