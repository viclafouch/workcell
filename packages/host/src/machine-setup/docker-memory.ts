import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const SETTINGS_PATH = join(
  homedir(),
  'Library',
  'Group Containers',
  'group.com.docker',
  'settings-store.json'
)

const MIB_PER_GB = 1024

const settingsSchema = z.record(z.string(), z.unknown())

type DockerSettings = z.infer<typeof settingsSchema>

export function withDockerMemory(settings: DockerSettings, memoryGb: number) {
  return { ...settings, MemoryMiB: memoryGb * MIB_PER_GB }
}

export async function readDockerSettings() {
  return settingsSchema.parse(JSON.parse(await readFile(SETTINGS_PATH, 'utf8')))
}

export async function writeDockerSettings(settings: DockerSettings) {
  await writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`)
}
