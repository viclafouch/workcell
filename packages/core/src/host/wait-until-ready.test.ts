import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { waitUntilReady } from './wait-until-ready.ts'

const DOCKER_DOWN = new Error('connect ENOENT /var/run/docker.sock')

const PROBES_UNTIL_ANSWER = 3

const START_ATTEMPTS = 12

function useFakeTimers() {
  vi.useFakeTimers()
  onTestFinished(() => {
    vi.useRealTimers()
  })
}

describe('the wait for a dependency at start', () => {
  it('retries until the dependency answers', async () => {
    useFakeTimers()
    const warnings: unknown[] = []
    const probe = vi
      .fn()
      .mockRejectedValueOnce(DOCKER_DOWN)
      .mockRejectedValueOnce(DOCKER_DOWN)
      .mockResolvedValue([])

    const waiting = waitUntilReady('sandbox provider', probe, {
      warn: (details) => {
        warnings.push(details)
      }
    })
    await vi.runAllTimersAsync()

    await expect(waiting).resolves.toBeUndefined()
    expect(probe).toHaveBeenCalledTimes(PROBES_UNTIL_ANSWER)
    expect(warnings).toStrictEqual([
      { dependency: 'sandbox provider', attempt: 1, error: DOCKER_DOWN },
      { dependency: 'sandbox provider', attempt: 2, error: DOCKER_DOWN }
    ])
  })

  it('fails with the cause once the dependency never answers', async () => {
    useFakeTimers()
    const probe = vi.fn().mockRejectedValue(DOCKER_DOWN)

    await Promise.all([
      expect(
        waitUntilReady('sandbox provider', probe, { warn: () => {} })
      ).rejects.toMatchObject({
        message: 'The sandbox provider did not answer at start.',
        cause: DOCKER_DOWN
      }),
      vi.runAllTimersAsync()
    ])

    expect(probe).toHaveBeenCalledTimes(START_ATTEMPTS)
  })
})
