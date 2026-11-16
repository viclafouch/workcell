import type { webApi } from '@slack/bolt'
import { AsyncQueuer } from '@tanstack/pacer'

export const POST_INTERVAL_MS = 1_000

export type SlackIcon = { url: string }

export type SlackIdentity = { username: string; icon?: SlackIcon }

export function identityFields(identity: SlackIdentity | undefined) {
  if (identity === undefined) {
    return {}
  }

  return identity.icon === undefined
    ? { username: identity.username }
    : { username: identity.username, icon_url: identity.icon.url }
}

export type SlackThread = { channel: string; threadTs: string }

export type SlackBlock = webApi.KnownBlock

export type SlackContent =
  | { markdown: string }
  | { text: string; blocks: SlackBlock[] }

export type SlackMetadata = NonNullable<webApi.ChatUpdateArguments['metadata']>

export type SlackPostParams = {
  channel: string
  threadTs?: string
  identity?: SlackIdentity
  metadata?: SlackMetadata
} & SlackContent

export type SlackEditParams = { channel: string; ts: string } & SlackContent

type PostingClient = {
  chat: {
    postMessage: (
      message: webApi.ChatPostMessageArguments
    ) => Promise<webApi.ChatPostMessageResponse>
    update: (
      message: webApi.ChatUpdateArguments
    ) => Promise<webApi.ChatUpdateResponse>
  }
}

type QueuedCall = () => Promise<void>

function fieldsOf(content: SlackContent) {
  return 'markdown' in content
    ? { markdown_text: content.markdown }
    : { text: content.text, blocks: content.blocks }
}

export function createChannelPoster(client: PostingClient) {
  const queues = new Map<string, AsyncQueuer<QueuedCall>>()

  const queueOf = (channel: string) => {
    const queue = queues.get(channel)

    if (queue) {
      return queue
    }

    const newQueue = new AsyncQueuer(
      async (call: QueuedCall) => {
        await call()
      },
      { wait: POST_INTERVAL_MS }
    )
    queues.set(channel, newQueue)

    return newQueue
  }

  const inQueue = async <Result>(
    channel: string,
    call: () => Promise<Result>
  ) => {
    const done = Promise.withResolvers<Result>()
    queueOf(channel).addItem(async () => {
      try {
        done.resolve(await call())
      } catch (error) {
        done.reject(error)
      }
    })

    return done.promise
  }

  const post = async ({
    channel,
    threadTs,
    identity,
    metadata,
    ...content
  }: SlackPostParams) => {
    const message: webApi.ChatPostMessageArguments = {
      channel,
      thread_ts: threadTs,
      ...fieldsOf(content),
      metadata,
      ...identityFields(identity),
      unfurl_links: false,
      unfurl_media: false
    }
    const { ts } = await inQueue(channel, () => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- chat.postMessage of the Slack Web API takes no target origin
      return client.chat.postMessage(message)
    })

    if (ts === undefined) {
      throw new Error(`Slack gave no timestamp to the post in ${channel}.`)
    }

    return ts
  }

  const edit = async ({ channel, ts, ...content }: SlackEditParams) => {
    await inQueue(channel, () => {
      return client.chat.update({ channel, ts, ...fieldsOf(content) })
    })
  }

  return { post, edit }
}
