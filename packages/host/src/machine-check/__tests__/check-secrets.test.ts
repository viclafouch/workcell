import { describe, expect, it } from 'vitest'
import type { ProbeVerdict } from '@workcell/core'
import { checkSecrets } from '#/machine-check/check-secrets.ts'

const STORED_SECRETS = new Map([
  ['NPM_TOKEN', 'npm_acme'],
  ['GITHUB_TOKEN', 'github_pat_acme'],
  ['MODEL_API_KEY', 'sk-acme']
])

const store = {
  read: async (name: string) => {
    return STORED_SECRETS.get(name)
  }
}

const COMMANDS = {
  check: 'acme machine:check',
  setSecret: (name: string) => {
    return `acme secrets:set ${name}`
  }
}

function probeAnswering(verdict: ProbeVerdict) {
  return {
    service: 'The service',
    probe: async () => {
      return verdict
    }
  }
}

describe('checkSecrets', () => {
  it('passes a secret that its service accepts, and a stored secret with no probe', async () => {
    const results = await checkSecrets({
      store,
      names: ['NPM_TOKEN', 'GITHUB_TOKEN'],
      probes: { NPM_TOKEN: probeAnswering('accepted') },
      commands: COMMANDS
    })

    expect(results).toStrictEqual([
      { label: 'NPM_TOKEN', ok: true },
      { label: 'GITHUB_TOKEN', ok: true }
    ])
  })

  it('names the cause and the fix of a missing, a refused and an unreachable secret', async () => {
    const results = await checkSecrets({
      store,
      names: ['SLACK_BOT_TOKEN', 'NPM_TOKEN', 'MODEL_API_KEY'],
      probes: {
        NPM_TOKEN: probeAnswering('refused'),
        MODEL_API_KEY: probeAnswering('unreachable')
      },
      commands: COMMANDS
    })

    expect(results).toStrictEqual([
      {
        label: 'SLACK_BOT_TOKEN',
        ok: false,
        fix: 'Missing: acme secrets:set SLACK_BOT_TOKEN'
      },
      {
        label: 'NPM_TOKEN',
        ok: false,
        fix: 'The service refuses it: acme secrets:set NPM_TOKEN'
      },
      {
        label: 'MODEL_API_KEY',
        ok: false,
        fix: 'The service does not answer: check the network, then run acme machine:check again'
      }
    ])
  })

  it('never carries a secret value', async () => {
    const results = await checkSecrets({
      store,
      names: ['NPM_TOKEN', 'GITHUB_TOKEN', 'MODEL_API_KEY'],
      probes: {
        NPM_TOKEN: probeAnswering('refused'),
        GITHUB_TOKEN: probeAnswering('unreachable')
      },
      commands: COMMANDS
    })

    expect(JSON.stringify(results)).not.toMatch(
      /npm_acme|github_pat_acme|sk-acme/u
    )
  })
})
