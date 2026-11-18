import { describe, expect, it, vi } from 'vitest'
import type { Modality } from '@tanstack/ai'
import { fakeText } from '@tanstack/ai/testing'
import { createHarnessHost, defineHarness } from '@tanstack/ai-harness'
import { mediaIdOf } from '@tanstack/ai-harness/media'
import { memoryPersistence } from '@tanstack/ai-persistence'
import {
  messageInput,
  type MessageFile,
  type MessageFileInfo,
  type MessageFileOptions
} from '#/inputs/message-files.ts'

const CLAUDE_MODALITIES: readonly Modality[] = ['text', 'image', 'document']

const IMAGE_BYTES = new TextEncoder().encode('image bytes')

const INVALID_UTF8_BYTE = 0xFF

const LONG_TEXT_LENGTH = 300_000

const SIZE_LIMIT_BYTES = 2_097_152

const OVER_THE_LIMIT_BYTES = 3_145_728

function fileOf(
  name: string,
  mimeType: string,
  body: Uint8Array | string = IMAGE_BYTES
): MessageFile {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body

  return {
    name,
    mimeType,
    size: bytes.byteLength,
    read: vi.fn(async () => {
      return bytes
    })
  }
}

function partsOf(input: unknown) {
  const parts: unknown[] = Array.isArray(input) ? input : []

  return parts
}

function textOf(input: unknown) {
  return JSON.stringify(input)
}

async function readMessage(
  files: readonly MessageFile[],
  options?: MessageFileOptions
) {
  const host = createHarnessHost({ persistence: memoryPersistence() })
  const harness = defineHarness({
    name: 'workcell/message-files-test',
    adapter: fakeText()
  })
  await using session = await host.open(harness, { threadId: 'files' })
  const onDownloadError =
    vi.fn<(file: MessageFileInfo, error: unknown) => void>()
  const input = await messageInput({
    text: 'Look at this.',
    files,
    modalities: CLAUDE_MODALITIES,
    options,
    putMedia: async (upload) => {
      return session.putMedia(upload)
    },
    onDownloadError
  })
  const loadMedia = async (part: unknown) => {
    await using reopened = await host.open(harness, { threadId: 'files' })

    return await reopened.loadMedia({ id: mediaIdOf(part) ?? '' })
  }

  return { input, loadMedia, onDownloadError }
}

describe('messageInput', () => {
  it('keeps the plain text when the message has no file', async () => {
    const { input } = await readMessage([])

    expect(input).toBe('Look at this.')
  })

  it('stores an image in the media store and sends a reference to it', async () => {
    const { input, loadMedia } = await readMessage([
      fileOf('mockup.png', 'image/png')
    ])
    const [, image] = partsOf(input)

    expect(image).toMatchObject({ type: 'image' })
    expect(await loadMedia(image)).toStrictEqual(IMAGE_BYTES)
  })

  it('stores a PDF as a document', async () => {
    const { input } = await readMessage([
      fileOf('contract.pdf', 'application/pdf')
    ])

    expect(input).toMatchObject([
      { type: 'text', content: 'Look at this.' },
      { type: 'document' }
    ])
  })

  it('sends an HTML, a Markdown and a JSON file as text', async () => {
    const { input } = await readMessage([
      fileOf('report.html', 'text/html', '<h1>LCP 4.8 s</h1>'),
      fileOf('notes.md', 'application/octet-stream', '# Plan'),
      fileOf('config.json', 'application/json', '{"a":1}')
    ])

    expect(input).toMatchObject([
      { type: 'text', content: 'Look at this.' },
      {
        type: 'text',
        content:
          '<file name="report.html" type="text/html">\n<h1>LCP 4.8 s</h1>\n</file>'
      },
      {
        type: 'text',
        content: '<file name="notes.md" type="text/markdown">\n# Plan\n</file>'
      },
      {
        type: 'text',
        content: '<file name="config.json" type="application/json">\n{"a":1}\n</file>'
      }
    ])
  })

  it('cuts a long text file and says where it stops', async () => {
    const { input } = await readMessage([
      fileOf('dump.txt', 'text/plain', 'a'.repeat(LONG_TEXT_LENGTH))
    ])

    expect(textOf(input)).toContain(
      'you got the first 200000 of 300000 characters'
    )
  })

  it('names each file it did not read, with its reason', async () => {
    const { input } = await readMessage([
      fileOf('archive.zip', 'application/zip'),
      fileOf('voice.mp3', 'audio/mpeg'),
      fileOf('mockup.png', 'image/png')
    ])

    expect(input).toMatchObject([
      { type: 'text' },
      { type: 'image' },
      { type: 'text' }
    ])
    expect(textOf(partsOf(input).at(-1))).toContain(
      '- archive.zip (application/zip): no reader exists for this type of file\\n- voice.mp3 (audio/mpeg): the model does not read audio files'
    )
  })

  it('reads only the files that the project accepts', async () => {
    const html = fileOf('page.html', 'text/html', '<p>ok</p>')
    const image = fileOf('mockup.png', 'image/png')
    const { input } = await readMessage([html, image], {
      accept: ({ mimeType }) => {
        return mimeType === 'text/html'
      }
    })

    expect(textOf(input)).toContain('<p>ok</p>')
    expect(textOf(input)).toContain(
      'mockup.png (image/png): the project does not read this type of file'
    )
    expect(image.read).not.toHaveBeenCalled()
  })

  it('refuses a file over the size limit before it downloads', async () => {
    const big = fileOf(
      'photo.png',
      'image/png',
      new Uint8Array(OVER_THE_LIMIT_BYTES)
    )
    const { input } = await readMessage([big], { maxBytes: SIZE_LIMIT_BYTES })

    expect(textOf(input)).toContain('bigger than the limit of 2 MB')
    expect(big.read).not.toHaveBeenCalled()
  })

  it('says a download failed and reports the error', async () => {
    const failing: MessageFile = {
      name: 'mockup.png',
      mimeType: 'image/png',
      read: async () => {
        throw new Error('missing scope')
      }
    }
    const { input, onDownloadError } = await readMessage([failing])

    expect(textOf(input)).toContain(
      'mockup.png (image/png): the download failed'
    )
    expect(onDownloadError).toHaveBeenCalledTimes(1)
  })

  it('refuses a text file that is not valid UTF-8', async () => {
    const { input } = await readMessage([
      fileOf('data.csv', 'text/csv', new Uint8Array([INVALID_UTF8_BYTE]))
    ])

    expect(textOf(input)).toContain('its text is not valid UTF-8')
  })
})
