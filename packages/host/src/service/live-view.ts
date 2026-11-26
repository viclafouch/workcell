import { z } from 'zod'
import { workerViewSchema } from '@workcell/core'
import { LOOPBACK } from './http-layer.ts'

const LIVE_VIEW_PATH = '/api/workers/inspect'

export function liveViewUrl(port: number) {
  return `http://${LOOPBACK}:${port}${LIVE_VIEW_PATH}`
}

export async function readLiveView(url: string) {
  const response = await fetch(url).catch(() => {
    return null
  })

  if (response === null) {
    return null
  }

  if (!response.ok) {
    throw new Error(`The live view answered ${response.status}.`)
  }

  return z.array(workerViewSchema).parse(await response.json())
}
