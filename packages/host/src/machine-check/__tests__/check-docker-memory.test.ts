import { describe, expect, it } from 'vitest'
import { toDockerMemoryResult } from '#/machine-check/check-docker-memory.ts'

const SIXTEEN_GB_SETTING_BYTES = 16_747_995_136

const EIGHT_GB_SETTING_BYTES = 8_319_504_384

const SIXTEEN_GB = {
  requiredGb: 16,
  commands: { setup: 'acme machine:setup' }
}

describe('toDockerMemoryResult', () => {
  it('passes the memory that Docker Desktop reports for a 16 GB setting', () => {
    expect(
      toDockerMemoryResult(SIXTEEN_GB_SETTING_BYTES, SIXTEEN_GB)
    ).toStrictEqual({
      label: 'Memory',
      ok: true
    })
  })

  it('names the memory of Docker and the setup command', () => {
    expect(
      toDockerMemoryResult(EIGHT_GB_SETTING_BYTES, SIXTEEN_GB)
    ).toStrictEqual({
      label: 'Memory',
      ok: false,
      fix: 'Docker has 7.7 GB: acme machine:setup'
    })
  })
})
