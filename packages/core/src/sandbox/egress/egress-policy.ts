export type CredentialRule = {
  secret: string
  hostname: string
  pathname?: string
  methods?: readonly string[]
  header: string
  value: (secret: string) => string
}

export type SandboxEgress = {
  allowedHosts: readonly string[]
  credentials: readonly CredentialRule[]
}

export type EgressConnection = 'terminate' | 'pass' | 'refuse'

export type EgressRequest = {
  method: string
  serverName: string
  url: string
  headers: Readonly<Record<string, string | readonly string[] | undefined>>
}

export type EgressDecision =
  | { action: 'fill'; rule: CredentialRule }
  | { action: 'forward' }
  | { action: 'refuse'; reason: string }

export function credentialPlaceholder(secret: string) {
  return `workcell-placeholder-${secret}`
}

export function bearerAuthorization(secret: string) {
  return `Bearer ${secret}`
}

export function basicAuthorization(username: string) {
  return (secret: string) => {
    return `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`
  }
}

function matchesHostname(pattern: string, hostname: string) {
  return new URLPattern({ hostname: pattern }).test({ hostname })
}

export function decideEgressConnection(
  egress: SandboxEgress,
  serverName: string
): EgressConnection {
  if (
    egress.credentials.some(({ hostname }) => {
      return matchesHostname(hostname, serverName)
    })
  ) {
    return 'terminate'
  }

  if (
    egress.allowedHosts.some((pattern) => {
      return matchesHostname(pattern, serverName)
    })
  ) {
    return 'pass'
  }

  return 'refuse'
}

function matchesRule(rule: CredentialRule, request: EgressRequest) {
  const { pathname } = new URL(request.url, 'https://placeholder.invalid')

  return (
    matchesHostname(rule.hostname, request.serverName) &&
    new URLPattern({ pathname: rule.pathname ?? '*' }).test({ pathname }) &&
    (rule.methods === undefined || rule.methods.includes(request.method))
  )
}

function headerValues(request: EgressRequest, name: string): readonly string[] {
  const value = request.headers[name]

  if (value === undefined) {
    return []
  }

  return typeof value === 'string' ? [value] : value
}

function withDecodedBasic(value: string) {
  const [scheme, credentials] = value.split(' ')

  if (scheme?.toLowerCase() !== 'basic' || credentials === undefined) {
    return [value]
  }

  return [value, Buffer.from(credentials, 'base64').toString()]
}

function secretsOf(egress: SandboxEgress) {
  return [
    ...new Set(
      egress.credentials.map(({ secret }) => {
        return secret
      })
    )
  ]
}

function secretsCarriedIn(
  texts: readonly string[],
  secrets: readonly string[]
) {
  return secrets.filter((secret) => {
    const placeholder = credentialPlaceholder(secret)

    return texts.some((text) => {
      return text.includes(placeholder)
    })
  })
}

function decodedUrl(url: string) {
  try {
    return [url, decodeURIComponent(url)]
  } catch {
    return [url]
  }
}

function textsOutside(request: EgressRequest, credentialHeader: string) {
  return [
    ...decodedUrl(request.url),
    ...Object.keys(request.headers)
      .filter((name) => {
        return name !== credentialHeader
      })
      .flatMap((name) => {
        return headerValues(request, name)
      })
  ]
}

export function secretCarriedIn(egress: SandboxEgress, text: string) {
  return secretsCarriedIn([text], secretsOf(egress))[0]
}

export function longestPlaceholderLength(egress: SandboxEgress) {
  return Math.max(
    0,
    ...secretsOf(egress).map((secret) => {
      return credentialPlaceholder(secret).length
    })
  )
}

function refuseOutsideScope(secret: string): EgressDecision {
  return {
    action: 'refuse',
    reason: `The request carries the placeholder of ${secret} outside the scope of its credential.`
  }
}

const ECHO_METHODS = new Set(['TRACE', 'TRACK'])

function hostnameOf(host: string) {
  return URL.parse(`https://${host}`)?.hostname
}

export function decideEgressRequest(
  egress: SandboxEgress,
  request: EgressRequest
): EgressDecision {
  if (ECHO_METHODS.has(request.method)) {
    return {
      action: 'refuse',
      reason: `The method ${request.method} echoes the request, and the credential with it.`
    }
  }

  const [host = ''] = headerValues(request, 'host')

  if (hostnameOf(host) !== request.serverName) {
    return {
      action: 'refuse',
      reason: `The Host header names ${host}, and the TLS server name is ${request.serverName}.`
    }
  }

  const secrets = secretsOf(egress)
  const rule = egress.credentials.find((candidate) => {
    return matchesRule(candidate, request)
  })
  const credentialHeader = rule?.header ?? 'authorization'
  const [carriedOutside] = secretsCarriedIn(
    textsOutside(request, credentialHeader),
    secrets
  )

  if (carriedOutside !== undefined) {
    return {
      action: 'refuse',
      reason: `The request carries the placeholder of ${carriedOutside} outside the header it fills.`
    }
  }

  const carriedInCredential = secretsCarriedIn(
    headerValues(request, credentialHeader).flatMap(withDecodedBasic),
    secrets
  )
  const foreignSecret = carriedInCredential.find((secret) => {
    return secret !== rule?.secret
  })

  if (foreignSecret !== undefined) {
    return refuseOutsideScope(foreignSecret)
  }

  if (rule === undefined) {
    return { action: 'forward' }
  }

  return { action: 'fill', rule }
}
