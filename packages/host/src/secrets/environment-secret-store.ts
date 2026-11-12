import type { SecretStore } from './secret-store.ts'

export type Environment = Readonly<Record<string, string | undefined>>

export function createEnvironmentSecretStore<Name extends string>(
  environment: Environment
): SecretStore<Name> {
  return {
    read: async (name) => {
      return environment[name]
    }
  }
}
