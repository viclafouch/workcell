import type { ConsoleContext } from './console-context.ts'
import { createFixtureContext } from './fixture-context.ts'

let fixtureContext: Promise<ConsoleContext> | null = null

export const readDevelopmentContext = async () => {
  fixtureContext ??= createFixtureContext()

  return fixtureContext
}
