import { describe, expect, it } from 'vitest'
import { withDockerMemory } from '#/machine-setup/docker-memory.ts'

const REQUIRED_GB = 16

describe('withDockerMemory', () => {
  it('sets the memory in MiB and keeps the other settings', () => {
    expect(
      withDockerMemory({ AutoStart: true, MemoryMiB: 8192 }, REQUIRED_GB)
    ).toStrictEqual({ AutoStart: true, MemoryMiB: 16_384 })
  })
})
