import type { PrStatus } from '../types'

type Check = { conclusion?: string | null; status?: string | null; state?: string | null }

type GhPrView = { state: string; isDraft: boolean; statusCheckRollup?: Check[] | null }

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const PENDING = new Set(['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED'])

const verdict = (check: Check): 'passed' | 'failed' | 'pending' => {
  const outcome = check.conclusion ?? check.state ?? ''
  if (PASSED.has(outcome)) return 'passed'
  if (outcome === '' || PENDING.has(outcome) || PENDING.has(check.status ?? '')) return 'pending'

  return 'failed'
}

export const prStatusFrom = (json: string): PrStatus | undefined => {
  try {
    const view = JSON.parse(json) as GhPrView
    const checks = (view.statusCheckRollup ?? []).map(verdict)

    return {
      state: view.state,
      isDraft: view.isDraft,
      passed: checks.filter(one => one === 'passed').length,
      failed: checks.filter(one => one === 'failed').length,
      pending: checks.filter(one => one === 'pending').length,
    }
  } catch {
    return undefined
  }
}

export const prBadge = (pr: PrStatus): string => {
  if (pr.state === 'MERGED') return 'merged'
  if (pr.state === 'CLOSED') return 'closed'

  const total = pr.passed + pr.failed + pr.pending
  const ci =
    total === 0
      ? 'no checks'
      : pr.failed > 0
        ? `CI ✗ ${pr.failed}/${total}`
        : pr.pending > 0
          ? `CI ● ${pr.pending}/${total} running`
          : `CI ✓ ${total}`

  return pr.isDraft ? `draft · ${ci}` : ci
}
