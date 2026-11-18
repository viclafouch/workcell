import { definePlugin } from '@tanstack/ai-harness'

export const SLACK_FORMATTING = [
  'Slack renders your messages as Markdown: bold, italic, strikethrough, links, lists, task lists, inline code and code blocks.',
  'It also renders quotes, dividers, tables, and headers at one size. An image shows as a link.',
  'A cell of a card table shows plain text only.',
  'Choose the formatting of each message from what it carries, as a designer would.',
  'A short reply stays plain text. Give structure the formatting that lets the reader scan it.'
].join('\n')

export const slackFormatting = definePlugin({
  name: 'workcell/slack-formatting',
  setup: () => {
    return {
      prompts: [{ id: 'workcell/slack-formatting', text: SLACK_FORMATTING }]
    }
  }
})
