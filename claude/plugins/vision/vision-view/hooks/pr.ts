import type { PrStatus } from '../types'

type CheckRollupEntry = { conclusion?: string | null; status?: string | null; state?: string | null }

type GhPrView = {
  number: number
  url: string
  state: string
  isDraft: boolean
  reviewDecision?: string | null
  statusCheckRollup?: CheckRollupEntry[] | null
}

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const PENDING = new Set(['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED'])

const verdict = (check: CheckRollupEntry): 'passed' | 'failed' | 'pending' => {
  const outcome = check.conclusion ?? check.state ?? ''
  if (PASSED.has(outcome)) return 'passed'
  if (outcome === '' || PENDING.has(outcome) || PENDING.has(check.status ?? '')) return 'pending'

  return 'failed'
}

export const prStatusFrom = (json: string, at: number): PrStatus | undefined => {
  try {
    const view = JSON.parse(json) as GhPrView
    const checks = (view.statusCheckRollup ?? []).map(verdict)

    return {
      number: view.number,
      url: view.url,
      state: view.state,
      isDraft: view.isDraft,
      reviewDecision: view.reviewDecision ?? '',
      passed: checks.filter(one => one === 'passed').length,
      failed: checks.filter(one => one === 'failed').length,
      pending: checks.filter(one => one === 'pending').length,
      fetchedAt: at,
    }
  } catch {
    return undefined
  }
}

export const ciLine = (pr: PrStatus): string => {
  const total = pr.passed + pr.failed + pr.pending
  if (total === 0) return 'CI · no checks reported'
  if (pr.failed > 0) return `CI ✗ ${pr.failed} of ${total} failing`
  if (pr.pending > 0) return `CI ● ${pr.pending} of ${total} running`

  return `CI ✓ ${total} passed`
}

export const nextAction = (pr: PrStatus): string => {
  if (pr.state === 'MERGED') return 'Nothing left: merged'
  if (pr.state === 'CLOSED') return 'Nothing left: closed without merging'
  if (pr.failed > 0) return 'Next: fix the failing checks'
  if (pr.pending > 0) return 'Next: wait for CI'
  if (pr.isDraft) return 'Next: review it, then mark it ready'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'Next: address the requested changes'
  if (pr.reviewDecision === 'APPROVED') return 'Next: merge'

  return 'Next: waiting for review'
}
