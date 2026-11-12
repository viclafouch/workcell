import { bearer, requestVerdict, type SecretProbe } from '@workcell/core'

const NPM_REGISTRY_URL = 'https://registry.npmjs.org'

export function modelGatewayProbe(gatewayUrl: string): SecretProbe {
  return {
    service: 'The model gateway',
    probe: (key) => {
      return requestVerdict(
        `${gatewayUrl.replace(/\/$/u, '')}/v1/models`,
        bearer(key)
      )
    }
  }
}

export function npmPackageProbe(packageName: string): SecretProbe {
  const [scope] = packageName.split('/')

  return {
    service: `npm, on the ${scope} scope,`,
    probe: (token) => {
      return requestVerdict(
        `${NPM_REGISTRY_URL}/${packageName.replace('/', '%2F')}`,
        bearer(token)
      )
    }
  }
}
