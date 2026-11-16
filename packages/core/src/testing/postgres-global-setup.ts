import type { TestProject } from 'vitest/node'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

const POSTGRES_IMAGE = 'postgres:18-alpine'

export async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()
  project.provide('postgresUrl', container.getConnectionUri())

  return async () => {
    await container.stop()
  }
}
