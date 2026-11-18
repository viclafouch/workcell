import type { FileUpload } from 'chat'
import { z } from 'zod'
import { AsyncRetryer } from '@tanstack/pacer'
import {
  cardToBlockKit,
  cardToFallbackText,
  type SlackAdapter
} from '@chat-adapter/slack'
import type {
  ChatIdentity,
  ChatMessage,
  IdentityPost,
  PlatformExtras,
  SessionStatus
} from '@workcell/chat'

export const SLACK_SECRET_NAMES = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN'
] as const

const SLACK_STATUS_LINE_MAX_LENGTH = 50

export const SLACK_CARD_LIMITS = {
  tables: 1,
  charts: 2,
  fields: 10,
  tableRows: 100,
  tableColumns: 20,
  chartTitle: 50,
  chartLabel: 20,
  chartSeries: 12,
  chartPoints: 20
}

function shownStatusLine(line: string) {
  const characters = Array.from(
    new Intl.Segmenter().segment(line),
    ({ segment }) => {
      return segment
    }
  )

  return characters.length > SLACK_STATUS_LINE_MAX_LENGTH
    ? `${characters.slice(0, SLACK_STATUS_LINE_MAX_LENGTH - 1).join('')}…`
    : line
}

const uploadUrlSchema = z.object({
  upload_url: z.string(),
  file_id: z.string()
})

const postedSchema = z.object({ ts: z.string() })

const slackErrorSchema = z.object({ data: z.object({ error: z.string() }) })

const FILE_NOT_READY_ERROR = 'invalid_blocks'

const FILE_READY_RETRY = { baseWait: 300, maxAttempts: 5 } as const

const BLOCK_IMAGE_NAME = /\.(?:png|jpe?g|gif)$/iu

type SlackPlatformOptions = { fileCaption?: (name: string) => string }

type UploadedFile = { id: string; title: string }

type PostTarget = { channel: string; threadTs: string | undefined }

function captionInEnglish(name: string) {
  return `From ${name}`
}

async function bytesOf(data: FileUpload['data']) {
  return data instanceof Blob
    ? new Uint8Array(await data.arrayBuffer())
    : new Uint8Array(data)
}

function filesOf(message: ChatMessage) {
  return 'files' in message ? (message.files ?? []) : []
}

function isBlockImage({ filename }: FileUpload) {
  return BLOCK_IMAGE_NAME.test(filename)
}

function contentOf(message: ChatMessage) {
  return 'card' in message
    ? {
        text: message.fallbackText ?? cardToFallbackText(message.card),
        blocks: cardToBlockKit(message.card)
      }
    : { markdown_text: message.markdown }
}

function imageBlocksOf(images: readonly UploadedFile[]) {
  return images.map(({ id, title }) => {
    return {
      type: 'image',
      slack_file: { id },
      alt_text: title,
      title: { type: 'plain_text', text: title }
    }
  })
}

export function slackPlatform(
  adapter: SlackAdapter,
  { fileCaption = captionInEnglish }: SlackPlatformOptions = {}
): PlatformExtras {
  const upload = async ({ filename, data }: FileUpload) => {
    const bytes = await bytesOf(data)
    const { upload_url: uploadUrl, file_id: id } = uploadUrlSchema.parse(
      await adapter.webClient.files.getUploadURLExternal({
        filename,
        length: bytes.byteLength
      })
    )
    const response = await fetch(uploadUrl, { method: 'POST', body: bytes })

    if (!response.ok) {
      throw new Error(
        `Slack refused the bytes of ${filename} with the status ${response.status}.`
      )
    }

    return { id, title: filename }
  }

  const uploadFiles = async (
    files: readonly FileUpload[],
    share: Record<string, unknown> = {}
  ) => {
    const uploaded = await Promise.all(files.map(upload))
    await adapter.webClient.apiCall('files.completeUploadExternal', {
      files: JSON.stringify(uploaded),
      ...share
    })

    return uploaded
  }

  const postOnceFilesReady = async (post: Record<string, unknown>) => {
    const posted = await new AsyncRetryer(async () => {
      try {
        return { result: await adapter.webClient.apiCall('chat.postMessage', post) }
      } catch (error) {
        if (
          slackErrorSchema.safeParse(error).data?.data.error ===
          FILE_NOT_READY_ERROR
        ) {
          throw error
        }

        return {
          error: Error.isError(error)
            ? error
            : new Error('Slack refused the post of the images.', {
                cause: error
              })
        }
      }
    }, FILE_READY_RETRY).execute()

    if (posted === undefined) {
      throw new Error('The post of the images was aborted.')
    }

    if (posted.error !== undefined) {
      throw posted.error
    }

    return postedSchema.parse(posted.result).ts
  }

  const postImagesAs = async (
    { channel, threadTs }: PostTarget,
    identity: ChatIdentity,
    images: readonly FileUpload[]
  ) => {
    const uploaded = await uploadFiles(images)

    return postOnceFilesReady({
      channel,
      thread_ts: threadTs,
      text: uploaded
        .map(({ title }) => {
          return title
        })
        .join(', '),
      blocks: imageBlocksOf(uploaded),
      username: identity.name,
      icon_url: identity.iconUrl
    })
  }

  const shareFilesFor = async (
    { channel, threadTs }: PostTarget,
    identity: ChatIdentity,
    files: readonly FileUpload[]
  ) => {
    await uploadFiles(files, {
      channel_id: channel,
      thread_ts: threadTs,
      initial_comment: fileCaption(identity.name)
    })
  }

  const postTextAs = async (
    { channel, threadTs }: PostTarget,
    identity: ChatIdentity,
    message: ChatMessage
  ) => {
    const post = {
      channel,
      thread_ts: threadTs,
      ...contentOf(message),
      username: identity.name,
      icon_url: identity.iconUrl,
      unfurl_links: false,
      unfurl_media: false
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- chat.postMessage of the Slack Web API takes no target origin
    const { ts } = await adapter.webClient.chat.postMessage(post)

    if (ts === undefined) {
      throw new Error(`Slack gave no timestamp to the post in ${channel}.`)
    }

    return ts
  }

  const postFilesAs = async (
    target: PostTarget,
    identity: ChatIdentity,
    message: ChatMessage
  ) => {
    const files = filesOf(message)
    const images = files.filter(isBlockImage)
    const others = files.filter((file) => {
      return !isBlockImage(file)
    })

    if ('markdown' in message && message.markdown !== '') {
      await postTextAs(target, identity, { markdown: message.markdown })
    }

    if (others.length > 0) {
      await shareFilesFor(target, identity, others)
    }

    return images.length > 0
      ? postImagesAs(target, identity, images)
      : (target.threadTs ?? '')
  }

  const postAs = async ({ target, message, identity }: IdentityPost) => {
    const { channel, threadTs } = adapter.decodeThreadId(
      'channelId' in target ? target.channelId : target.threadId
    )
    const postTarget = { channel, threadTs: threadTs || undefined }
    const ts =
      filesOf(message).length > 0
        ? await postFilesAs(postTarget, identity, message)
        : await postTextAs(postTarget, identity, message)

    return {
      threadId: adapter.encodeThreadId({ channel, threadTs: threadTs || ts }),
      messageId: ts
    }
  }

  const setStatus = async (
    threadId: string,
    status: SessionStatus,
    identity?: ChatIdentity
  ) => {
    const { channel, threadTs } = adapter.decodeThreadId(threadId)
    await adapter.webClient.apiCall('agents.sessions.setStatus', {
      channel_id: channel,
      thread_ts: threadTs,
      status,
      username: identity?.name,
      icon_url: identity?.iconUrl
    })
  }

  const setStatusLine = async (
    threadId: string,
    line: string,
    identity?: ChatIdentity
  ) => {
    const { channel, threadTs } = adapter.decodeThreadId(threadId)
    const shown = shownStatusLine(line)
    await adapter.webClient.apiCall(
      'assistant.threads.setStatus',
      shown === ''
        ? { channel_id: channel, thread_ts: threadTs, status: shown }
        : {
            channel_id: channel,
            thread_ts: threadTs,
            status: shown,
            loading_messages: [shown],
            username: identity?.name,
            icon_url: identity?.iconUrl
          }
    )
  }

  return { postAs, setStatus, setStatusLine }
}
