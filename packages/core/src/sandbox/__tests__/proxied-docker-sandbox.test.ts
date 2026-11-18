import { describe, expect, it } from 'vitest'
import { sandboxContainerDefinition } from '#/sandbox/proxied-docker-sandbox.ts'

const SANDBOX = {
  key: 'worker-sandbox',
  image: 'project-sandbox',
  keepAliveCommand: ['tail', '-f', '/dev/null'],
  sandboxEnv: {},
  labels: {}
}

describe('the container definition of a proxied Docker sandbox', () => {
  it('mounts each cache volume at its path', () => {
    const { HostConfig } = sandboxContainerDefinition({
      ...SANDBOX,
      cacheVolumes: [
        { name: 'project-pnpm-store', mountPath: '/home/agent/.pnpm-store' },
        { name: 'project-cargo-registry', mountPath: '/home/agent/.cargo' }
      ]
    })

    expect(HostConfig?.Mounts).toStrictEqual([
      {
        Type: 'volume',
        Source: 'project-pnpm-store',
        Target: '/home/agent/.pnpm-store'
      },
      {
        Type: 'volume',
        Source: 'project-cargo-registry',
        Target: '/home/agent/.cargo'
      }
    ])
  })
})
