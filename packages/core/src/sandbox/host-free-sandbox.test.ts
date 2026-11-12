import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHostFreeSandbox } from './host-free-sandbox.ts'

let hostFree: Awaited<ReturnType<typeof createHostFreeSandbox>>

describe('a host-free sandbox', () => {
  beforeAll(async () => {
    hostFree = await createHostFreeSandbox()
  })

  afterAll(async () => {
    await hostFree.destroy()
  })

  it('runs its commands with no GitHub login of the host', async () => {
    await expect(
      hostFree.sandbox.process.exec('gh auth status')
    ).resolves.not.toMatchObject({ exitCode: 0 })
  })
})
