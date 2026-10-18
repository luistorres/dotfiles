import type { Reviewer, ReviewerKind } from '../types'

// A lookbehind for quotes keeps `pgrep -f "second-opinion"` and friends from counting as a launch.
const KINDS: { kind: ReviewerKind; command: RegExp; process: string }[] = [
  { kind: 'second-opinion', command: /(?<!["'\w-])second-opinion\s/, process: 'second-opinion' },
]

export const reviewerKind = (command: string): ReviewerKind | undefined =>
  KINDS.find(one => one.command.test(command))?.kind

const assignments = (command: string): Map<string, string> =>
  new Map(
    [...command.matchAll(/(?:^|[;&|\s])([A-Za-z_]\w*)=([^\s;&|]+)/g)].map(([, name, value]) => [name ?? '', value ?? '']),
  )

export const expandVariables = (text: string, command: string): string => {
  const vars = assignments(command)

  return text.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (whole, name: string) => vars.get(name) ?? whole)
}

export const logToken = (command: string): string | undefined => command.match(/>\s*(\S+\.(?:log|txt))/)?.[1]

export const logPath = (command: string): string | undefined => {
  const token = logToken(command)

  return token === undefined ? undefined : expandVariables(token, command)
}

export const modelOf = (command: string): string => command.match(/--model[\s=](\S+)/)?.[1] ?? ''

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The launching shell's argv holds the command as written, so the unexpanded log token names this run alone.
export const livenessPattern = (reviewer: Pick<Reviewer, 'kind' | 'label' | 'logToken'>): string => {
  if (reviewer.logToken !== undefined) return escapeRegex(reviewer.logToken)

  const process = KINDS.find(one => one.kind === reviewer.kind)?.process ?? reviewer.kind
  const model = reviewer.label.split(' · ')[1]

  return model === undefined ? escapeRegex(process) : `${escapeRegex(process)}.*${escapeRegex(model)}`
}

const FAILURE = /^(?:ERROR\b|\w*Error:)|usage limit|not supported|"status":\s*[45]\d\d/i


export const failureLine = (logTail: string): string | undefined => {
  const lines = logTail.split('\n')
  const error = lines.find(line => FAILURE.test(line))
  if (error !== undefined) return error.trim().slice(0, 160)

  return lines.every(line => line.trim() === '') ? 'exited without writing a review' : undefined
}

// Each review cycle launches every external reviewer once, so the busiest kind's count is the cycle.
export const reviewCycle = (reviewers: readonly Reviewer[], since: number): number => {
  const launched = reviewers.filter(one => one.startedAt >= since)
  const counts = KINDS.map(({ kind }) => launched.filter(one => one.kind === kind).length)

  return Math.max(0, ...counts)
}

export const pullRequestUrl = (text: string): string | undefined =>
  text.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/)?.[0]
