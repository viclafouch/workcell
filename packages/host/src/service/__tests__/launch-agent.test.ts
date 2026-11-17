import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { defineLaunchAgent } from '#/service/launch-agent.ts'

const LAUNCH_AGENT = defineLaunchAgent({
  label: 'dev.acme.agent',
  appName: 'acme-agent',
  workingDirectory: '/srv/acme',
  hostArguments: ['host.ts'],
  environment: {},
  logFileVariable: 'LOG_FILE'
})

describe.runIf(process.platform === 'darwin')('the launch agent', () => {
  it('restarts a host that crashes, and leaves stopped a host that exits cleanly', () => {
    const keepAlive = execFileSync(
      '/usr/bin/plutil',
      ['-extract', 'KeepAlive', 'json', '-o', '-', '-'],
      { input: LAUNCH_AGENT.plist(), encoding: 'utf8' }
    )

    expect(JSON.parse(keepAlive)).toStrictEqual({ SuccessfulExit: false })
  })
})
