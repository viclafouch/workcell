import { afterEach, beforeEach, vi, type MockInstance } from 'vitest'

const CONSOLE_METHODS = [
  'error',
  'warn',
  'log',
  'info',
  'debug'
] as const satisfies (keyof Console)[]

type ConsoleMethod = (typeof CONSOLE_METHODS)[number]

let consoleSpies: [ConsoleMethod, MockInstance][] = []

beforeEach(() => {
  consoleSpies = CONSOLE_METHODS.map((method) => {
    return [method, vi.spyOn(console, method)]
  })
})

afterEach(() => {
  for (const [method, spy] of consoleSpies) {
    const { calls } = spy.mock
    const isMockedByTheTest = spy.getMockImplementation() !== undefined

    if (calls.length > 0 && !isMockedByTheTest) {
      throw new Error(
        `The test logged console.${method}: ${calls
          .map((args) => {
            return args.map(String).join(' ')
          })
          .join(' | ')}`
      )
    }
  }
})
