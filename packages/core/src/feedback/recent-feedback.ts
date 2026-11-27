import type { DeliverFeedback, FeedbackReport } from './feedback.ts'

const KEPT_REPORTS = 100

export type ReadSavedFeedback = () => Promise<readonly FeedbackReport[]>

export function createRecentFeedback() {
  const reports: FeedbackReport[] = []
  let saved: Promise<readonly FeedbackReport[]> | null = null

  const deliverThrough = (deliver?: DeliverFeedback) => {
    const recordThenDeliver: DeliverFeedback = async (report, options) => {
      reports.push(report)
      reports.splice(0, Math.max(0, reports.length - KEPT_REPORTS))
      await deliver?.(report, options)
    }

    return recordThenDeliver
  }

  const readSavedOnce = async (readSaved: ReadSavedFeedback) => {
    saved ??= readSaved()

    try {
      return await saved
    } catch (error) {
      saved = null
      throw error
    }
  }

  const listRecentFeedback = async (
    readSaved: ReadSavedFeedback = async () => {
      return []
    }
  ) => {
    const known = new Map(
      [...(await readSavedOnce(readSaved)), ...reports].map((report) => {
        return [report.id, report]
      })
    )

    return [...known.values()]
      .toReversed()
      .toSorted((first, second) => {
        return second.at.localeCompare(first.at)
      })
      .slice(0, KEPT_REPORTS)
  }

  return { deliverThrough, listRecentFeedback }
}
