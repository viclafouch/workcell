import { describe, expect, it } from 'vitest'
import { renderReport } from '#/machine-check/render-report.ts'

const COMMANDS = { check: 'acme machine:check' }

describe('renderReport', () => {
  it('aligns each check under its group, with the fix of each failed one', () => {
    const report = renderReport(
      [
        {
          title: 'Docker',
          results: [{ label: 'Daemon', ok: true }]
        },
        {
          title: 'Secrets',
          results: [
            {
              label: 'GITHUB_TOKEN',
              ok: false,
              fix: 'acme secrets:set GITHUB_TOKEN'
            }
          ]
        }
      ],
      { commands: COMMANDS }
    )

    expect(report).toBe(
      [
        '',
        '  Docker',
        '    ✔ Daemon',
        '',
        '  Secrets',
        '    ✘ GITHUB_TOKEN   acme secrets:set GITHUB_TOKEN',
        '',
        '  1 of 2 checks fail. Run the fix next to each ✘, then acme machine:check again.',
        ''
      ].join('\n')
    )
  })

  it('says the machine is ready when every check passes', () => {
    const report = renderReport(
      [{ title: 'Docker', results: [{ label: 'Daemon', ok: true }] }],
      { commands: COMMANDS }
    )

    expect(report).toContain(
      'All 1 checks pass. This machine can build and run the sandbox.'
    )
  })
})
