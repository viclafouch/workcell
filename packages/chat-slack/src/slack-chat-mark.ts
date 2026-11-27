import { readFileSync } from 'node:fs'

const SLACK_MARK_SVG = readFileSync(
  new URL('slack-mark.svg', import.meta.url),
  'utf8'
)

export const SLACK_CHAT_MARK = {
  adapter: 'slack',
  name: 'Slack',
  iconUrl: `data:image/svg+xml,${encodeURIComponent(SLACK_MARK_SVG)}`
}
