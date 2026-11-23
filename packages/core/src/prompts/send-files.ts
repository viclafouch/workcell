import { megabytesOf } from './file-size.ts'

export const SEND_FILE_TEXT = {
  description: [
    'Send a file to the person, after your answer: a slide deck, a page, a document, a data table, code, an image or a video that they download.',
    'Call it when the person asks for a file, or when the answer is a document too long for a message.',
    'Give the file one of two ways: write it whole in content, as text, such as HTML with its CSS and scripts inline, Markdown, CSV, JSON, SVG or code. Or give the path of a file you can read, such as an image or a video you made.',
    'Your text answer then says in one line what the file holds, and repeats none of it.'
  ].join('\n'),
  name: 'The file name the person gets, with its extension, such as deck.html or chart.png. No folder.',
  content:
    'The whole content of the file, as text. Leave it out when you give a path.',
  path: 'The path of the file, as your file tools read it. Leave it out when you give content.',
  oneSource: 'Give content or path, one of the two.',
  sent: (name: string) => {
    return `${name} is sent to the person.`
  },
  tooBig: (maxBytes: number) => {
    return `The file is bigger than the limit of ${megabytesOf(maxBytes)} MB, so it is not sent. Tell the person.`
  },
  holdsSecret:
    'The file holds a secret value of the host, so it is not sent. Tell the person, with no detail of the secret.'
} as const
