export type ProbeVerdict = 'accepted' | 'refused' | 'unreachable'

export type SecretProbe = {
  service: string
  probe: (value: string) => Promise<ProbeVerdict>
}

export const PROBE_TIMEOUT_MS = 15_000

export async function requestVerdict(
  url: string,
  init: RequestInit = {}
): Promise<ProbeVerdict> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })

    return response.ok ? 'accepted' : 'refused'
  } catch {
    return 'unreachable'
  }
}

export function bearer(token: string) {
  return { headers: { authorization: `Bearer ${token}` } }
}
