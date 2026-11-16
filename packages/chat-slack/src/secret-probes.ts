import { z } from 'zod'
import {
  bearer,
  PROBE_TIMEOUT_MS,
  type ProbeVerdict,
  type SecretProbe
} from '@workcell/core'

const SLACK_API_URL = 'https://slack.com/api'

const slackAnswerSchema = z.object({ ok: z.boolean() })

async function slackVerdict(
  method: string,
  token: string
): Promise<ProbeVerdict> {
  try {
    const response = await fetch(`${SLACK_API_URL}/${method}`, {
      method: 'POST',
      ...bearer(token),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    const { ok } = slackAnswerSchema.parse(await response.json())

    return ok ? 'accepted' : 'refused'
  } catch {
    return 'unreachable'
  }
}

export const SLACK_BOT_PROBE: SecretProbe = {
  service: 'Slack',
  probe: (token) => {
    return slackVerdict('auth.test', token)
  }
}

export const SLACK_APP_PROBE: SecretProbe = {
  service: 'Slack Socket Mode',
  probe: (token) => {
    return slackVerdict('apps.connections.open', token)
  }
}
