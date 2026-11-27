import { DEFAULT_BRAND_NAME } from '#/constants/brand.ts'
import type { ConsoleContext } from './console-context.ts'
import { STDERR_LOGGER } from './stderr-logger.ts'

const SERVICE_UNAVAILABLE = 503

const HOSTLESS_REFUSAL =
  'The console answers only once a host mounts it: start the host, then open the address it logs'

const refuse = () => {
  return Promise.reject(new Error(HOSTLESS_REFUSAL))
}

const refuseRequest = async () => {
  return new Response(HOSTLESS_REFUSAL, { status: SERVICE_UNAVAILABLE })
}

export const HOSTLESS_CONTEXT: ConsoleContext = {
  brand: { name: DEFAULT_BRAND_NAME },
  logger: STDERR_LOGGER,
  harness: { worker: refuseRequest, bot: refuseRequest },
  workers: { capacity: 0, view: refuse, inspect: refuse, diff: refuse },
  feedback: { recent: refuse }
}
