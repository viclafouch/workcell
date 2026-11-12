import { requestVerdict, type SecretProbe } from '@workcell/core'
import { LINEAR_GRAPHQL_URL } from './linear-api.ts'

export const LINEAR_PROBE: SecretProbe = {
  service: 'Linear',
  probe: (key) => {
    return requestVerdict(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: { authorization: key, 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { id } }' })
    })
  }
}
