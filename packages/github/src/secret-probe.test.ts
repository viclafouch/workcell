import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { githubProbe } from './secret-probe.ts'

const GITHUB_TOKEN = 'github_pat_acme'

const NOT_FOUND_STATUS = 404

const UNAUTHORIZED_STATUS = 401

const network = setupServer(
  http.get(
    'https://api.github.com/repos/acme/:name/actions/runs',
    ({ request, params }) => {
      if (params.name !== 'app') {
        return HttpResponse.json({}, { status: NOT_FOUND_STATUS })
      }

      return request.headers.get('authorization') === `Bearer ${GITHUB_TOKEN}`
        ? HttpResponse.json({})
        : HttpResponse.json({}, { status: UNAUTHORIZED_STATUS })
    }
  )
)

describe('the GitHub probe', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  afterAll(() => {
    network.close()
  })

  it('accepts a GitHub token only when every repository answers', async () => {
    await expect(githubProbe(['acme/app']).probe(GITHUB_TOKEN)).resolves.toBe(
      'accepted'
    )
    await expect(
      githubProbe(['acme/app', 'acme/tools']).probe(GITHUB_TOKEN)
    ).resolves.toBe('refused')
  })
})
