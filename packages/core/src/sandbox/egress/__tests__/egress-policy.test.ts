import { describe, expect, it } from 'vitest'
import {
  basicAuthorization,
  bearerAuthorization,
  credentialPlaceholder,
  decideEgressConnection,
  decideEgressRequest,
  type SandboxEgress
} from '#/sandbox/egress/egress-policy.ts'

const GIT_RULE = {
  secret: 'FORGE_TOKEN',
  hostname: 'forge.example',
  pathname: '/team/app{.git}?/*',
  header: 'authorization',
  value: basicAuthorization('x-access-token')
}

const API_RULE = {
  secret: 'FORGE_TOKEN',
  hostname: 'api.forge.example',
  header: 'authorization',
  value: bearerAuthorization
}

const REGISTRY_RULE = {
  secret: 'REGISTRY_TOKEN',
  hostname: 'registry.example',
  methods: ['GET', 'HEAD'],
  header: 'authorization',
  value: bearerAuthorization
}

const EGRESS: SandboxEgress = {
  allowedHosts: [
    'forge.example',
    'api.forge.example',
    'registry.example',
    'objects.cdn(\\d+).example'
  ],
  credentials: [GIT_RULE, API_RULE, REGISTRY_RULE]
}

const FORGE_PLACEHOLDER = credentialPlaceholder('FORGE_TOKEN')

type RequestParams = {
  method?: string
  serverName?: string
  url?: string
  headers?: Record<string, string>
}

function request({
  method = 'GET',
  serverName = 'api.forge.example',
  url = '/user',
  headers = {}
}: RequestParams) {
  return { method, serverName, url, headers: { host: serverName, ...headers } }
}

describe('the egress policy of a sandbox', () => {
  it('terminates the hosts of its credential map, passes the other allowed hosts, and refuses the rest', () => {
    expect([
      decideEgressConnection(EGRESS, 'forge.example'),
      decideEgressConnection(EGRESS, 'objects.cdn42.example'),
      decideEgressConnection(EGRESS, 'attacker.example')
    ]).toStrictEqual(['terminate', 'pass', 'refuse'])
  })

  it('fills the header of the matching rule when the client sends its placeholder', () => {
    expect(
      decideEgressRequest(
        EGRESS,
        request({ headers: { authorization: `token ${FORGE_PLACEHOLDER}` } })
      )
    ).toStrictEqual({ action: 'fill', rule: API_RULE })
  })

  it('fills the header of the matching rule when the client sends no credential', () => {
    expect([
      decideEgressRequest(
        EGRESS,
        request({
          method: 'POST',
          serverName: 'forge.example',
          url: '/team/app.git/git-upload-pack'
        })
      ),
      decideEgressRequest(
        EGRESS,
        request({
          serverName: 'forge.example',
          url: '/team/app/info/refs?service=git-upload-pack'
        })
      )
    ]).toStrictEqual([
      { action: 'fill', rule: GIT_RULE },
      { action: 'fill', rule: GIT_RULE }
    ])
  })

  it('forwards a request that matches no rule and carries no placeholder', () => {
    expect(
      decideEgressRequest(
        EGRESS,
        request({
          serverName: 'forge.example',
          url: '/someone/public.git/info/refs'
        })
      )
    ).toStrictEqual({ action: 'forward' })
  })

  it('refuses a placeholder outside the scope of its credential', () => {
    expect([
      decideEgressRequest(
        EGRESS,
        request({
          method: 'PUT',
          serverName: 'registry.example',
          url: '/@team%2fpackage',
          headers: {
            authorization: `Bearer ${credentialPlaceholder('REGISTRY_TOKEN')}`
          }
        })
      ),
      decideEgressRequest(
        EGRESS,
        request({
          headers: {
            authorization: `Bearer ${credentialPlaceholder('REGISTRY_TOKEN')}`
          }
        })
      ),
      decideEgressRequest(
        EGRESS,
        request({
          serverName: 'forge.example',
          url: '/someone/else.git/info/refs',
          headers: {
            authorization:
              basicAuthorization('x-access-token')(FORGE_PLACEHOLDER)
          }
        })
      )
    ]).toStrictEqual([
      {
        action: 'refuse',
        reason:
          'The request carries the placeholder of REGISTRY_TOKEN outside the scope of its credential.'
      },
      {
        action: 'refuse',
        reason:
          'The request carries the placeholder of REGISTRY_TOKEN outside the scope of its credential.'
      },
      {
        action: 'refuse',
        reason:
          'The request carries the placeholder of FORGE_TOKEN outside the scope of its credential.'
      }
    ])
  })

  it('refuses a placeholder in the URL, raw or encoded, and in any other header', () => {
    const outsideTheHeader = {
      action: 'refuse',
      reason:
        'The request carries the placeholder of FORGE_TOKEN outside the header it fills.'
    }

    expect([
      decideEgressRequest(
        EGRESS,
        request({ url: `/search?q=${FORGE_PLACEHOLDER}` })
      ),
      decideEgressRequest(
        EGRESS,
        request({
          url: `/search?q=${encodeURIComponent(`"${FORGE_PLACEHOLDER}"`)}`
        })
      ),
      decideEgressRequest(
        EGRESS,
        request({
          headers: {
            authorization: `token ${FORGE_PLACEHOLDER}`,
            'x-debug': FORGE_PLACEHOLDER
          }
        })
      )
    ]).toStrictEqual([outsideTheHeader, outsideTheHeader, outsideTheHeader])
  })

  it('refuses a Host header that names another host than the TLS server name', () => {
    expect([
      decideEgressRequest(
        EGRESS,
        request({ headers: { host: 'attacker.example' } })
      ),
      decideEgressRequest(
        EGRESS,
        request({ headers: { host: 'api.forge.example:443' } })
      )
    ]).toStrictEqual([
      {
        action: 'refuse',
        reason:
          'The Host header names attacker.example, and the TLS server name is api.forge.example.'
      },
      { action: 'fill', rule: API_RULE }
    ])
  })

  it('refuses a method that echoes the request back', () => {
    expect(
      decideEgressRequest(EGRESS, request({ method: 'TRACE' }))
    ).toStrictEqual({
      action: 'refuse',
      reason: 'The method TRACE echoes the request, and the credential with it.'
    })
  })
})

describe('the header value of a credential', () => {
  it('formats a bearer token and HTTP Basic credentials', () => {
    expect([
      bearerAuthorization('secret-value'),
      basicAuthorization('x-access-token')('secret-value')
    ]).toStrictEqual([
      'Bearer secret-value',
      'Basic eC1hY2Nlc3MtdG9rZW46c2VjcmV0LXZhbHVl'
    ])
  })
})
