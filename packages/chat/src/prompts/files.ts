export const FILE_TOOL_TEXT = {
  description: [
    'Send a file to the person, in the chat thread, after your answer: a slide deck, a page, a document, a data table or code that they download.',
    'Call it when the person asks for a file, or when the answer is a document too long for a message.',
    'Write the whole file in content, as text: HTML with its CSS and scripts inline, Markdown, CSV, JSON, SVG or code.',
    'Your text answer then says in one line what the file holds, and repeats none of it.'
  ].join('\n'),
  name: 'The file name with its extension, such as deck.html or figures.csv. No folder.',
  content: 'The whole content of the file, as text.',
  sent: (name: string) => {
    return `${name} is sent in the thread.`
  }
} as const
