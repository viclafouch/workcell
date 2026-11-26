import type { DashboardContext } from './dashboard-context.ts'
import { createFixtureContext } from './fixture-context.ts'

let fixtureContext: Promise<DashboardContext> | null = null

export const readDevelopmentContext = async () => {
  fixtureContext ??= createFixtureContext()

  return fixtureContext
}
