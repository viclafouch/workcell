import { describe, expect, it } from 'vitest'
import { pathInside, WORKSPACE_ROOT } from '#/sandbox/sandbox-facts.ts'

describe('pathInside', () => {
  it('resolves a path inside the workspace, relative or absolute', () => {
    expect([
      pathInside(WORKSPACE_ROOT, 'out/chart.png'),
      pathInside(WORKSPACE_ROOT, '/workspace/repo/./README.md'),
      pathInside(WORKSPACE_ROOT, 'repo/../repo/a.md')
    ]).toStrictEqual([
      '/workspace/out/chart.png',
      '/workspace/repo/README.md',
      '/workspace/repo/a.md'
    ])
  })

  it('refuses a path that leaves the workspace', () => {
    expect(() => {
      return pathInside(WORKSPACE_ROOT, '../etc/passwd')
    }).toThrow('outside the workspace')
    expect(() => {
      return pathInside(WORKSPACE_ROOT, '/workspace-other/a.md')
    }).toThrow('outside the workspace')
  })
})
