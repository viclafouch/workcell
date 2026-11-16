import { describe, expect, it } from 'vitest'
import { pickFreeName } from '#/workers/worker-names.ts'

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta']

describe('pickFreeName', () => {
  it('picks every free name at random, and never a taken one', () => {
    const picked = new Set(
      Array.from({ length: 200 }, () => {
        return pickFreeName(NAMES, new Set(['Bravo']))
      })
    )

    expect([...picked].toSorted()).toStrictEqual(['Alpha', 'Charlie', 'Delta'])
  })

  it('refuses a new worker when every name is taken', () => {
    expect(() => {
      return pickFreeName(['Alpha'], new Set(['Alpha']))
    }).toThrow('Every worker name is taken by a live worker: Alpha.')
  })
})
