import { describe, expect, it } from 'vitest'
import { createSecretStore, loadSecrets } from './secret-store.ts'

const SECRET_NAMES = [
  'MODEL_API_KEY',
  'GITHUB_TOKEN',
  'SLACK_BOT_TOKEN',
  'DATABASE_URL'
] as const

const EVERY_SECRET = {
  MODEL_API_KEY: 'sk-acme-model-key',
  GITHUB_TOKEN: 'github_pat_acme',
  SLACK_BOT_TOKEN: 'xoxb-acme',
  DATABASE_URL: 'postgres://agent:pooled@db.example.com/agent'
}

function environmentStore(environment: Record<string, string | undefined>) {
  return createSecretStore<(typeof SECRET_NAMES)[number]>({
    kind: 'environment',
    appName: 'acme-agent',
    environment
  })
}

describe('loadSecrets from the environment store', () => {
  it('returns every secret, and no other variable', async () => {
    const store = environmentStore({ ...EVERY_SECRET, HOME: '/home/acme' })

    await expect(loadSecrets(store, SECRET_NAMES)).resolves.toStrictEqual(
      EVERY_SECRET
    )
  })

  it('returns only the secrets it names, and reads no other', async () => {
    const store = environmentStore({
      GITHUB_TOKEN: 'github_pat_acme',
      MODEL_API_KEY: undefined
    })

    await expect(loadSecrets(store, ['GITHUB_TOKEN'])).resolves.toStrictEqual({
      GITHUB_TOKEN: 'github_pat_acme'
    })
  })

  it('fails with the name of each missing or empty secret, and no value', async () => {
    const store = environmentStore({
      ...EVERY_SECRET,
      GITHUB_TOKEN: undefined,
      SLACK_BOT_TOKEN: ''
    })

    await expect(loadSecrets(store, SECRET_NAMES)).rejects.toThrow(
      /^Missing secrets: GITHUB_TOKEN, SLACK_BOT_TOKEN\.$/u
    )
  })
})
