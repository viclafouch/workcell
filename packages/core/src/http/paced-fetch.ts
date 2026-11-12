import { AsyncRetryer, RateLimiter } from '@tanstack/pacer'

const WINDOW_MS = 60_000

export const REQUEST_TIMEOUT_MS = 30_000

const MAX_RETRY_WAIT_MS = 30_000

const DEFAULT_MAX_ATTEMPTS = 4

const UNNAMED_RATE_LIMIT_WAIT_MS = 60_000

const MS_PER_SECOND = 1000

const FIRST_SERVER_ERROR_STATUS = 500

export type RateLimitCheck = { url: string; response: Response; text: string }

type PacedFetchOptions = {
  apiName: string
  subject: string
  requestsPerMinute: number
  maxAttempts?: number
  headers: Record<string, string>
  isRateLimited: (check: RateLimitCheck) => boolean
  rateLimitResetAt: (headers: Headers) => number | undefined
}

type PacedAnswer = { status: number; text: string }

export type PacedRequest = Omit<RequestInit, 'headers' | 'signal'> & {
  headers?: Record<string, string>
}

type Attempt =
  | { answer: PacedAnswer }
  | { rateLimitedForMs: number }
  | { overBudgetForMs: number }

function rateLimitWaitMs(
  headers: Headers,
  rateLimitResetAt: PacedFetchOptions['rateLimitResetAt']
) {
  const retryAfterSeconds = Number(headers.get('retry-after') ?? Number.NaN)

  if (Number.isFinite(retryAfterSeconds)) {
    return retryAfterSeconds * MS_PER_SECOND
  }

  const resetAt = rateLimitResetAt(headers)

  return resetAt === undefined
    ? UNNAMED_RATE_LIMIT_WAIT_MS
    : Math.max(resetAt - Date.now(), 0)
}

export function createPacedFetch({
  apiName,
  subject,
  requestsPerMinute,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  headers,
  isRateLimited,
  rateLimitResetAt
}: PacedFetchOptions) {
  const httpCalls = new RateLimiter(() => {}, {
    limit: requestsPerMinute,
    window: WINDOW_MS,
    windowType: 'sliding'
  })
  let rateLimitedUntil = 0

  const fetchOnce = async (
    url: string,
    init: PacedRequest
  ): Promise<Attempt> => {
    if (!httpCalls.maybeExecute()) {
      return { overBudgetForMs: httpCalls.getMsUntilNextWindow() }
    }

    const response = await fetch(url, {
      ...init,
      headers: { ...headers, ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })

    if (response.status >= FIRST_SERVER_ERROR_STATUS) {
      throw new Error(
        `${apiName} answered ${response.status} to ${init.method ?? 'GET'} ${url} of ${subject}.`
      )
    }

    const text = await response.text()

    return isRateLimited({ url, response, text })
      ? {
          rateLimitedForMs: rateLimitWaitMs(response.headers, rateLimitResetAt)
        }
      : { answer: { status: response.status, text } }
  }

  const retryers = new Set<AsyncRetryer<typeof fetchOnce>>()

  const rateLimitError = () => {
    return new Error(
      `${apiName} rate limits ${subject} until ${new Date(rateLimitedUntil).toISOString()}. The call did not run.`
    )
  }

  const pacedFetch = async (url: string, init: PacedRequest = {}) => {
    if (Date.now() < rateLimitedUntil) {
      throw rateLimitError()
    }

    const retryer = new AsyncRetryer(fetchOnce, {
      maxAttempts,
      maxWait: MAX_RETRY_WAIT_MS,
      jitter: 0.2
    })
    retryers.add(retryer)
    const attempt = await retryer.execute(url, init).finally(() => {
      retryers.delete(retryer)
    })

    if (attempt === undefined) {
      throw new Error(`${subject} stopped before ${apiName} answered.`)
    }

    if ('overBudgetForMs' in attempt) {
      throw new Error(
        `The budget of ${subject} is ${requestsPerMinute} ${apiName} requests a minute: the next request can run in ${Math.ceil(attempt.overBudgetForMs / MS_PER_SECOND)} s. The call did not run.`,
        { cause: retryer.store.state.lastError }
      )
    }

    if ('rateLimitedForMs' in attempt) {
      rateLimitedUntil = Date.now() + attempt.rateLimitedForMs
      throw rateLimitError()
    }

    return attempt.answer
  }

  return {
    pacedFetch,
    [Symbol.dispose]: () => {
      for (const retryer of retryers) {
        retryer.abort()
      }

      retryers.clear()
      httpCalls.reset()
    }
  }
}
