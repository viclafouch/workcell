import type { ContentPart, Modality } from '@tanstack/ai'
import type { MediaRecord, UserInput } from '@tanstack/ai-harness'
import {
  kindOf,
  MediaError,
  mediaPart,
  mimeTypeOf
} from '@tanstack/ai-harness/media'
import type { LogLine } from '#/store/database.ts'
import { MESSAGE_FILES_TEXT } from '#/prompts/message-files.ts'

const DEFAULT_MAX_BYTES = 5_242_880

const TEXT_MAX_CHARACTERS = 200_000

const UNKNOWN_MIME_TYPE = 'application/octet-stream'

const TEXT_APPLICATION_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/sql',
  'application/graphql',
  'application/x-sh',
  'application/x-httpd-php'
])

const TEXT_SUFFIX = /\+(?:json|xml|yaml)$/u

export type MessageFileInfo = {
  name: string
  mimeType: string
  size?: number
}

export type MessageFile = MessageFileInfo & {
  read: () => Promise<Uint8Array>
}

export type MessageFileOptions = {
  accept?: (file: MessageFileInfo) => boolean
  maxBytes?: number
}

type PutMedia = (upload: {
  body: Uint8Array
  mimeType: string
  name: string
}) => Promise<MediaRecord>

type ReadContext = {
  modalities: readonly Modality[] | undefined
  accept: (file: MessageFileInfo) => boolean
  maxBytes: number
  putMedia: PutMedia
  onDownloadError: (file: MessageFileInfo, error: unknown) => void
}

type FileReading = { part: ContentPart } | { notRead: string }

type MessageInputParams = {
  text: string
  files: readonly MessageFile[]
  modalities: readonly Modality[] | undefined
  putMedia: PutMedia
  onDownloadError: (file: MessageFileInfo, error: unknown) => void
  options?: MessageFileOptions
}

function acceptEveryFile() {
  return true
}

function resolvedMimeType({ name, mimeType }: MessageFileInfo) {
  const declared = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''

  if (declared !== '' && declared !== UNKNOWN_MIME_TYPE) {
    return declared
  }

  return mimeTypeOf(name) ?? UNKNOWN_MIME_TYPE
}

function isText(mimeType: string) {
  return (
    mimeType.startsWith('text/') ||
    TEXT_APPLICATION_TYPES.has(mimeType) ||
    TEXT_SUFFIX.test(mimeType)
  )
}

function modalityOf(mimeType: string): Modality | undefined {
  return isText(mimeType) ? 'text' : kindOf(mimeType)
}

function decodedText(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function textPart(info: MessageFileInfo, text: string): ContentPart {
  const content =
    text.length > TEXT_MAX_CHARACTERS
      ? `${text.slice(0, TEXT_MAX_CHARACTERS)}\n${MESSAGE_FILES_TEXT.truncated(TEXT_MAX_CHARACTERS, text.length)}`
      : text

  return {
    type: 'text',
    content: MESSAGE_FILES_TEXT.file(info.name, info.mimeType, content)
  }
}

function refusalOf(
  info: MessageFileInfo,
  context: ReadContext
): string | undefined {
  const { reasons } = MESSAGE_FILES_TEXT
  const modality = modalityOf(info.mimeType)

  if (!context.accept(info)) {
    return reasons.refused
  }

  if (modality === undefined) {
    return reasons.noReader
  }

  if (
    modality !== 'text' &&
    context.modalities !== undefined &&
    !context.modalities.includes(modality)
  ) {
    return reasons.model(modality)
  }

  return (info.size ?? 0) > context.maxBytes
    ? reasons.tooBig(context.maxBytes)
    : undefined
}

async function downloaded(
  file: MessageFile,
  info: MessageFileInfo,
  context: ReadContext
) {
  try {
    return await file.read()
  } catch (error) {
    context.onDownloadError(info, error)

    return null
  }
}

async function readMessageFile(
  file: MessageFile,
  info: MessageFileInfo,
  context: ReadContext
): Promise<FileReading> {
  const { reasons } = MESSAGE_FILES_TEXT
  const refusal = refusalOf(info, context)

  if (refusal !== undefined) {
    return { notRead: refusal }
  }

  const bytes = await downloaded(file, info, context)

  if (bytes === null) {
    return { notRead: reasons.download }
  }

  if (bytes.byteLength > context.maxBytes) {
    return { notRead: reasons.tooBig(context.maxBytes) }
  }

  if (isText(info.mimeType)) {
    const text = decodedText(bytes)

    return text === null
      ? { notRead: reasons.notText }
      : { part: textPart(info, text) }
  }

  try {
    const record = await context.putMedia({
      body: bytes,
      mimeType: info.mimeType,
      name: info.name
    })

    return { part: mediaPart(record) }
  } catch (error) {
    if (error instanceof MediaError) {
      return { notRead: error.message }
    }

    throw error
  }
}

export async function messageInput({
  text,
  files,
  modalities,
  options = {},
  putMedia,
  onDownloadError
}: MessageInputParams): Promise<UserInput> {
  if (files.length === 0) {
    return text
  }

  const context: ReadContext = {
    modalities,
    accept: options.accept ?? acceptEveryFile,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    putMedia,
    onDownloadError
  }
  const readings = await Promise.all(
    files.map(async (file) => {
      const info = { name: file.name, mimeType: resolvedMimeType(file), size: file.size }

      return { info, reading: await readMessageFile(file, info, context) }
    })
  )
  const parts = readings.flatMap(({ reading }) => {
    return 'part' in reading ? [reading.part] : []
  })
  const notRead = readings.flatMap(({ info, reading }) => {
    return 'notRead' in reading
      ? [MESSAGE_FILES_TEXT.notReadLine(info.name, info.mimeType, reading.notRead)]
      : []
  })

  return [
    ...(text === '' ? [] : [{ type: 'text' as const, content: text }]),
    ...parts,
    ...(notRead.length === 0
      ? []
      : [{ type: 'text' as const, content: MESSAGE_FILES_TEXT.notRead(notRead) }])
  ]
}

type ReadMessageParams = {
  session: { putMedia: PutMedia }
  text: string
  files: readonly MessageFile[]
}

type CreateMessageReaderParams = {
  modalities: readonly Modality[] | undefined
  logger: { warn: LogLine }
  options?: MessageFileOptions
}

export function createMessageReader({
  modalities,
  options,
  logger
}: CreateMessageReaderParams) {
  return ({ session, text, files }: ReadMessageParams) => {
    return messageInput({
      text,
      files,
      modalities,
      options,
      putMedia: (upload) => {
        return session.putMedia(upload)
      },
      onDownloadError: ({ name, mimeType }, error) => {
        logger.warn(
          { name, mimeType, error },
          'A file of a message failed to download.'
        )
      }
    })
  }
}

export type MessageReader = ReturnType<typeof createMessageReader>
