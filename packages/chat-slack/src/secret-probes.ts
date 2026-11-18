import { callSlackApi } from '@chat-adapter/slack/api'
import {
  PROBE_TIMEOUT_MS,
  type ProbeVerdict,
  type SecretProbe
} from '@workcell/core'

const fetchWithinProbeTime: typeof fetch = (input, init) => {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
  })
}

async function slackVerdict(
  method: string,
  token: string
): Promise<ProbeVerdict> {
  try {
    const { ok } = await callSlackApi(
      method,
      {},
      { token, fetch: fetchWithinProbeTime }
    )

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
