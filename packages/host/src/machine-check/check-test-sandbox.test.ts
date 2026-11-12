import { describe, expect, it } from 'vitest'
import { toTestSandboxResult } from './check-test-sandbox.ts'

const APP_TEST_SANDBOX = {
  dockerLabel: 'acme.test-sandbox',
  sandboxName: 'web'
}

describe('toTestSandboxResult', () => {
  it('passes when no test sandbox runs', () => {
    expect(toTestSandboxResult('', APP_TEST_SANDBOX)).toStrictEqual({
      label: 'Test sandbox',
      ok: true
    })
  })

  it('names the command that stops a test sandbox left running', () => {
    expect(
      toTestSandboxResult('3f2a9c1b7d4e\n', APP_TEST_SANDBOX)
    ).toStrictEqual({
      label: 'Test sandbox',
      ok: false,
      fix: 'A web test sandbox still runs: docker rm --force $(docker ps --quiet --filter label=acme.test-sandbox)'
    })
  })
})
