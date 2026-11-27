import { describe, expect, it, vi } from 'vitest'
import type { FeedbackReport } from '#/feedback/feedback.ts'
import { createRecentFeedback } from '#/feedback/recent-feedback.ts'

const KEPT_REPORTS = 100

const reportNumbered = (index: number): FeedbackReport => {
  return {
    id: `report-${index}`,
    at: '2026-11-01T10:00:00Z',
    kind: 'broken',
    impact: 'friction',
    observed: 'The tool failed.',
    expected: 'The tool works.',
    source: 'agent',
    harness: 'workcell/worker',
    model: 'fake',
    threadId: 'thread-1',
    runId: 'run-1',
    version: '0.0.0'
  }
}

const NO_SIGNAL = { signal: new AbortController().signal }

describe('the recent feedback of a host', () => {
  it('lists the newest report first, and still hands each one to the delivery of the distribution', async () => {
    const delivered: string[] = []
    const recent = createRecentFeedback()
    const deliver = recent.deliverThrough(async (report) => {
      delivered.push(report.id)
    })

    await deliver(reportNumbered(1), NO_SIGNAL)
    await deliver(reportNumbered(2), NO_SIGNAL)

    const listed = await recent.listRecentFeedback()

    expect(
      listed.map(({ id }) => {
        return id
      })
    ).toStrictEqual(['report-2', 'report-1'])
    expect(delivered).toStrictEqual(['report-1', 'report-2'])
  })

  it('keeps a bounded list, dropping the oldest reports', async () => {
    const recent = createRecentFeedback()
    const deliver = recent.deliverThrough()

    await Promise.all(
      Array.from({ length: KEPT_REPORTS + 1 }, (_, index) => {
        return deliver(reportNumbered(index), NO_SIGNAL)
      })
    )

    const listed = await recent.listRecentFeedback()

    expect(listed).toHaveLength(KEPT_REPORTS)
    expect(listed.at(-1)?.id).toBe('report-1')
  })

  it('reads the saved reports once, newest first, and keeps one copy of each', async () => {
    const recent = createRecentFeedback()
    const deliver = recent.deliverThrough()
    let reads = 0
    const readSaved = async () => {
      reads += 1

      return [
        { ...reportNumbered(1), at: '2026-11-01T09:00:00Z' },
        { ...reportNumbered(2), at: '2026-11-01T11:00:00Z' }
      ]
    }

    await deliver(reportNumbered(2), NO_SIGNAL)
    await recent.listRecentFeedback(readSaved)
    const listed = await recent.listRecentFeedback(readSaved)

    expect(
      listed.map(({ id }) => {
        return id
      })
    ).toStrictEqual(['report-2', 'report-1'])
    expect(reads).toBe(1)
  })

  it('reads the saved reports again after a failed read', async () => {
    const recent = createRecentFeedback()
    const readSaved = vi
      .fn<() => Promise<FeedbackReport[]>>()
      .mockRejectedValueOnce(new Error('The store is asleep.'))
      .mockResolvedValueOnce([reportNumbered(1)])

    await expect(recent.listRecentFeedback(readSaved)).rejects.toThrow(
      'The store is asleep.'
    )

    expect(await recent.listRecentFeedback(readSaved)).toHaveLength(1)
  })
})
