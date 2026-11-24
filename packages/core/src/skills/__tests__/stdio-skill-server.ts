import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { loadSkillCatalog, testMcpServer } from './skill-server.ts'

export const STDIO_SERVER_GREETING = 'The test skills server listens on stdio.'

export async function serveSkillsOnStdio() {
  const catalog = await loadSkillCatalog()
  await testMcpServer(catalog).connect(new StdioServerTransport())
  process.stderr.write(`${STDIO_SERVER_GREETING}\n`)
}
