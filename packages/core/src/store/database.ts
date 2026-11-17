import { setTimeout } from 'node:timers/promises'
import {
  Client,
  escapeIdentifier,
  Pool,
  TypeOverrides,
  types,
  type PoolClient,
  type QueryResultRow
} from 'pg'
import { z } from 'zod'
import { AsyncRetryer } from '@tanstack/pacer'
import {
  findPendingMigrations,
  MIGRATIONS_DIRECTORY
} from './migrate-database.ts'

export type LogLine = (
  details: Record<string, unknown>,
  message: string
) => void

type DatabaseLogger = { warn: LogLine; error: LogLine }

type RunOnParams = {
  client: PoolClient
  name: string
  text: string
  values?: readonly unknown[]
}

type OpenDatabaseParams = {
  url: string
  directUrl: string
  logger: DatabaseLogger
}

export type DatabaseNotice =
  | { kind: 'notification'; payload: string }
  | { kind: 'listening' }
  | { kind: 'reconnected' }

type NoticeListener = (notice: DatabaseNotice) => void

export type TransactionQuery = <Row extends QueryResultRow>(
  text: string,
  values?: readonly unknown[]
) => Promise<Row[]>

export const DATABASE_SECRET_NAMES = [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED'
] as const

const CONNECT_RETRY = {
  baseWait: 500,
  jitter: 0.2
} as const

const REFUSED_CREDENTIALS_OR_DATABASE = /^(?:28|3D)[0-9A-Z]{3}$/u

const COLD_START_CONNECTION_TIMEOUT_MS = 10_000

const IDLE_CONNECTION_TIMEOUT_MS = 10_000

const LISTEN_RETRY_WAIT_MS = 10_000

function createDatabaseTypes() {
  const overrides = new TypeOverrides()
  overrides.setTypeParser(types.builtins.INT8, Number)

  return overrides
}

const errorCodeSchema = z.object({ code: z.string() })

class DatabaseQueryError extends Error {
  readonly queryName: string

  readonly code: string | undefined

  constructor(queryName: string, code: string | undefined) {
    super(`The query "${queryName}" failed with the code ${code ?? 'unknown'}.`)
    this.name = 'DatabaseQueryError'
    this.queryName = queryName
    this.code = code
  }
}

function readErrorCode(error: unknown) {
  return errorCodeSchema.safeParse(error).data?.code
}

async function connectWithRetry<Connection>(
  open: () => Promise<Connection>,
  logger: DatabaseLogger
) {
  const connection = await new AsyncRetryer(
    async () => {
      try {
        return { opened: await open() }
      } catch (error) {
        if (
          Error.isError(error) &&
          REFUSED_CREDENTIALS_OR_DATABASE.test(readErrorCode(error) ?? '')
        ) {
          return { error }
        }

        throw error
      }
    },
    {
      ...CONNECT_RETRY,
      onRetry: (attempt, error) => {
        logger.warn(
          { attempt, code: readErrorCode(error) },
          'The database connection failed. Retrying.'
        )
      }
    }
  ).execute()

  if (!connection) {
    throw new Error('The database connection retry was aborted.')
  }

  if (connection.error !== undefined) {
    throw connection.error
  }

  return connection.opened
}

function createNotificationHub(directUrl: string, logger: DatabaseLogger) {
  const listeners = new Map<string, Set<NoticeListener>>()
  let isClosed = false
  let isBehind = false
  let listenChain: Promise<null> = Promise.resolve(null)
  let listening: ReturnType<typeof openClient> | null = null

  const deliver = (channel: string, notice: DatabaseNotice) => {
    for (const listener of listeners.get(channel) ?? []) {
      listener(notice)
    }
  }

  const logFailure = (error: unknown) => {
    logger.error(
      { code: readErrorCode(error) },
      'The database listener failed.'
    )
  }

  const listenTo = async (client: Client, channel: string) => {
    const previous = listenChain
    const { promise, resolve } = Promise.withResolvers<null>()
    listenChain = promise

    try {
      await previous
      await client.query(`LISTEN ${escapeIdentifier(channel)}`)
    } finally {
      resolve(null)
    }
  }

  const openClient = async () => {
    const client = await connectWithRetry(async () => {
      const candidate = new Client({
        connectionString: directUrl,
        enableChannelBinding: true,
        keepAlive: true,
        connectionTimeoutMillis: COLD_START_CONNECTION_TIMEOUT_MS
      })
      candidate.on('error', (error) => {
        logger.warn(
          { code: readErrorCode(error) },
          'The database listener lost its connection.'
        )
      })
      await candidate.connect()

      return candidate
    }, logger)
    const { promise: ended, resolve: end } = Promise.withResolvers<undefined>()
    client.once('end', end)
    client.on('notification', ({ channel, payload }) => {
      if (payload !== undefined) {
        deliver(channel, { kind: 'notification', payload })
      }
    })

    for (const channel of listeners.keys()) {
      // oxlint-disable-next-line no-await-in-loop -- one client runs the LISTEN of each channel in turn
      await listenTo(client, channel)
    }

    return { client, ended }
  }

  const ensureListening = async () => {
    if (!listening) {
      const started = openClient()
      listening = started
      void reconnectAfterEnd(started)
    }

    const opened = await listening

    if (isBehind) {
      isBehind = false

      for (const channel of listeners.keys()) {
        deliver(channel, { kind: 'reconnected' })
      }
    }

    return opened
  }

  const reconnect = async () => {
    try {
      await ensureListening()
    } catch {
      isBehind = true
    }
  }

  const reconnectLater = async () => {
    await setTimeout(LISTEN_RETRY_WAIT_MS, undefined, { ref: false })

    if (!isClosed && !listening && listeners.size > 0) {
      await reconnect()
    }
  }

  const reconnectAfterEnd = async (started: ReturnType<typeof openClient>) => {
    let isStarted = false

    try {
      const { ended } = await started
      isStarted = true
      await ended
    } catch (error) {
      logFailure(error)
    }

    if (listening !== started) {
      return
    }

    listening = null

    if (listeners.size > 0) {
      isBehind = true
      await (isStarted ? reconnect() : reconnectLater())
    }
  }

  const listenToChannel = async (channel: string) => {
    const isAlreadyListening = listening !== null
    const opened = await ensureListening().catch(() => {
      return null
    })

    if (opened === null) {
      return
    }

    try {
      if (isAlreadyListening) {
        await listenTo(opened.client, channel)
      }

      deliver(channel, { kind: 'listening' })
    } catch (error) {
      logFailure(error)
    }
  }

  const stopListening = async () => {
    const stopped = listening
    listening = null

    if (!stopped) {
      return
    }

    try {
      const { client } = await stopped
      await client.end()
    } catch (error) {
      logFailure(error)
    }
  }

  return {
    listen: (channel: string, listener: NoticeListener) => {
      const channelListeners = listeners.getOrInsertComputed(channel, () => {
        return new Set()
      })
      const isNewChannel = channelListeners.size === 0
      channelListeners.add(listener)

      if (isNewChannel || !listening) {
        void listenToChannel(channel)
      }

      return () => {
        channelListeners.delete(listener)

        if (channelListeners.size === 0) {
          listeners.delete(channel)
        }

        if (listeners.size === 0) {
          void stopListening()
        }
      }
    },
    close: async () => {
      isClosed = true
      listeners.clear()
      await stopListening()
    }
  }
}

export function openDatabase({ url, directUrl, logger }: OpenDatabaseParams) {
  const pool = new Pool({
    connectionString: url,
    enableChannelBinding: true,
    connectionTimeoutMillis: COLD_START_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_CONNECTION_TIMEOUT_MS,
    types: createDatabaseTypes()
  })
  const notifications = createNotificationHub(directUrl, logger)

  pool.on('error', (error) => {
    logger.warn(
      { code: readErrorCode(error) },
      'The server closed an idle database connection.'
    )
  })

  const close = async () => {
    await notifications.close()
    await pool.end()
  }

  const failQuery = (name: string, error: unknown) => {
    const code = readErrorCode(error)
    logger.error({ queryName: name, code }, 'The query failed.')

    return new DatabaseQueryError(name, code)
  }

  const connect = async (name: string) => {
    try {
      return await connectWithRetry(async () => {
        return pool.connect()
      }, logger)
    } catch (error) {
      throw failQuery(name, error)
    }
  }

  const runOn = async <Row extends QueryResultRow>({
    client,
    name,
    text,
    values = []
  }: RunOnParams) => {
    try {
      const result = await client.query<Row>(text, [...values])

      return result.rows
    } catch (error) {
      throw failQuery(name, error)
    }
  }

  return {
    query: async <Row extends QueryResultRow>(
      name: string,
      text: string,
      values: readonly unknown[] = []
    ) => {
      const client = await connect(name)

      try {
        return await runOn<Row>({ client, name, text, values })
      } finally {
        client.release()
      }
    },
    transaction: async <Result>(
      name: string,
      work: (query: TransactionQuery) => Promise<Result>
    ) => {
      const client = await connect(name)
      let isBroken = false

      try {
        await runOn({ client, name, text: 'BEGIN' })
        const result = await work(async (text, values) => {
          return runOn({ client, name, text, values })
        })
        await runOn({ client, name, text: 'COMMIT' })

        return result
      } catch (error) {
        try {
          await client.query('ROLLBACK')
        } catch {
          isBroken = true
        }

        throw error
      } finally {
        client.release(isBroken)
      }
    },
    pendingMigrations: async () => {
      return findPendingMigrations({
        url: directUrl,
        directory: MIGRATIONS_DIRECTORY
      })
    },
    listen: notifications.listen,
    close,
    [Symbol.asyncDispose]: close
  }
}

export type Database = ReturnType<typeof openDatabase>
