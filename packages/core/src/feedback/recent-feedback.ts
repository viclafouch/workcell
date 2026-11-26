import type { DeliverFeedback, FeedbackReport } from './feedback.ts'

const KEPT_REPORTS = 100

export function createRecentFeedback() {
  const reports: FeedbackReport[] = []

  const deliverThrough = (deliver?: DeliverFeedback) => {
    const recordThenDeliver: DeliverFeedback = async (report, options) => {
      reports.push(report)
      reports.splice(0, Math.max(0, reports.length - KEPT_REPORTS))
      await deliver?.(report, options)
    }

    return recordThenDeliver
  }

  const listRecentFeedback = () => {
    return reports.toReversed()
  }

  return { deliverThrough, listRecentFeedback }
}
