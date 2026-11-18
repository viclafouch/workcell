import { AuthenticationLinearError, LinearClient } from '@linear/sdk'
import { PROBE_TIMEOUT_MS, type SecretProbe } from '@workcell/core'

export const LINEAR_PROBE: SecretProbe = {
  service: 'Linear',
  probe: async (apiKey) => {
    try {
      await new LinearClient({
        apiKey,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      }).viewer

      return 'accepted'
    } catch (error) {
      return error instanceof AuthenticationLinearError
        ? 'refused'
        : 'unreachable'
    }
  }
}
