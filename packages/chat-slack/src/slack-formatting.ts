import { definePlugin } from '@tanstack/ai-harness'

export const SLACK_FORMATTING = [
  'Your messages render as Markdown in Slack: **bold**, _italic_, ~~strikethrough~~, [links](url), bullet and numbered lists, task lists, `inline code`, code blocks with a language, > quotes, --- dividers, tables, and # headers, all at one size. An image shows as a link, and the cells of a card table show plain text only.',
  'Choose the formatting of each message from what it carries, as a designer would. A short reply stays plain text. A message with structure gets the formatting that lets the reader scan it: a list for several items, bold on the word that matters, a code block for a command.'
].join('\n')

export const slackFormatting = definePlugin({
  name: 'workcell/slack-formatting',
  setup: () => {
    return {
      prompts: [{ id: 'workcell/slack-formatting', text: SLACK_FORMATTING }]
    }
  }
})
