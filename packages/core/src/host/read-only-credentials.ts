import type { CredentialStore } from '@tanstack/ai/byok'

function refuseWrite(): never {
  throw new Error('These credentials are read-only.')
}

export function readOnlyCredentials(
  secrets: Readonly<Record<string, string>>
): CredentialStore {
  return {
    get: async ({ id }) => {
      const value = secrets[id]

      return value === undefined ? null : { type: 'api_key', value }
    },
    set: refuseWrite,
    delete: refuseWrite,
    list: async () => {
      return Object.keys(secrets).map((id) => {
        return { id, type: 'api_key' as const }
      })
    }
  }
}
