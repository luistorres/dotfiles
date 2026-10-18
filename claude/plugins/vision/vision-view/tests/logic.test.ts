import { expect, test } from 'claude-code/testing'

import { failureLine, livenessPattern, logPath, logToken, pullRequestUrl, reviewCycle, reviewerKind } from '../hooks/reviewers'
import { flatten, shipNodes, stepAnchor, stepNodes, withoutFinished } from '../hooks/tree'
import { ciLine, nextAction, prStatusFrom } from '../hooks/pr'
import { currentStep, isInProgress, oneLine, parseWorkflow, stateFileOf } from '../hooks/workflow'
import type { Reviewer } from '../types'

const SINGLE = `---
Status: in_progress
Shape: single
Branch: lt/vision-view
---
# Vision view pane

## Steps
- [x] frame · [x] build · [ ] review · [ ] fix · [ ] verify · [ ] ship
`

const STACK = `---
Status: in_progress
Shape: stack
Current: 2 / 3 (PR open, draft)
---
# Production bring-up

## [x] Task 1 — Serve runtime config
- [x] build · [x] review · [x] fix · [x] verify · [x] pr

## [ ] Task 2 — Write the runbook
- [x] build · [ ] review · [ ] fix · [ ] verify · [ ] pr

## [ ] Task 3 — Wire the app spec
`

const node = (id: string, parentId?: string, isLive = true) => ({ id, parentId, kind: 'agent' as const, label: id, meta: '', isLive, tone: 'none' as const })

test('a single-PR state file reads its branch and stops at the first unticked step', () => {
  const single = parseWorkflow('x.md', SINGLE)

  expect(isInProgress(SINGLE)).toBe(true)
  expect(single.kind).toBe('single')
  expect(single.title).toBe('Vision view pane')
  expect(single.headline).toBe('lt/vision-view')
  expect(single.steps.map(step => step.label)).toEqual(['frame', 'build', 'review', 'fix', 'verify', 'ship'])
  expect(currentStep(single.steps)?.label).toBe('review')
})

test('a stack state file reads the current task and its own step checklist', () => {
  const stack = parseWorkflow('x.md', STACK)

  expect(stack.kind).toBe('stack')
  expect(stack.title).toBe('Production bring-up')
  expect(stack.headline).toBe('2 / 3 (PR open, draft)')
  expect(currentStep(stack.steps)?.label).toBe('Task 2 — Write the runbook')
  expect(currentStep(stack.substeps)?.label).toBe('review')
})

test('a done state file is not in progress', () => {
  expect(isInProgress(SINGLE.replace('in_progress', 'done'))).toBe(false)
})

test('second-opinion launches are recognised with their log file', () => {
  const launch = 'second-opinion code-reviewer "$D/inputs-abc1234.md" /repo/wt > /tmp/v/second-opinion-abc1234.log 2>&1'

  expect(reviewerKind(launch)).toBe('second-opinion')
  expect(logPath(launch)).toBe('/tmp/v/second-opinion-abc1234.log')
  expect(reviewerKind('/plugins/vision/bin/second-opinion code-reviewer in.md /repo')).toBe('second-opinion')
  expect(reviewerKind('git status')).toBe(undefined)
})

test('the review cycle is the busiest reviewer count since the loop started', () => {
  const launch = (kind: Reviewer['kind'], startedAt: number): Reviewer => ({
    id: `${kind}-${startedAt}`,
    kind,
    label: kind,
    startedAt,
    logBytes: 0,
    grewAt: startedAt,
  })
  const launched = [launch('second-opinion', 5), launch('second-opinion', 20), launch('second-opinion', 40)]

  expect(reviewCycle(launched, 10)).toBe(2)
  expect(reviewCycle(launched, 100)).toBe(0)
})

test('a PR url is found in gh pr create output', () => {
  expect(pullRequestUrl('Creating pull request\nhttps://github.com/acme/app/pull/842\n')).toBe(
    'https://github.com/acme/app/pull/842',
  )
})

test('the tree nests children under their parent and keeps orphans at the root', () => {
  const rows = flatten([node('a'), node('b', 'a'), node('c'), node('d', 'gone')], new Set(['a']))

  expect(rows.map(row => `${row.prefix}${row.id}`)).toEqual(['├ a', '│ └ b', '├ c', '└ d'])
  expect(rows[1]?.indent).toBe('│   ')
})

test('agents start collapsed, so a closed agent hides its children', () => {
  expect(flatten([node('a'), node('b', 'a')], new Set()).map(row => row.id)).toEqual(['a'])
})

test('agents sit under the step that was current when they started', () => {
  const stack = { ...parseWorkflow('x.md', STACK), updatedAt: 0 }
  const anchor = stepAnchor(stack)
  const steps = stepNodes(stack, [anchor ?? '', 'x.md::Task 1 — Serve runtime config/build'])
  const rows = flatten([...steps, node('impl', anchor)], new Set())

  expect(anchor).toBe('x.md::Task 2 — Write the runbook/review')
  expect(rows.map(row => `${row.prefix}${row.label}`)).toEqual([
    '├ ✓ Task 1 — Serve runtime config',
    '├ ▶ Task 2 — Write the runbook',
    '│ ├ ✓ build',
    '│ ├ ▶ review',
    '│ │ └ impl',
    '│ ├ · fix',
    '│ ├ · verify',
    '│ └ · pr',
    '└ · Task 3 — Wire the app spec',
  ])
})

test('a single-PR run lists its steps flat', () => {
  const single = { ...parseWorkflow('x.md', SINGLE), updatedAt: 0 }
  const rows = flatten(stepNodes(single, []), new Set())

  expect(rows.map(row => `${row.prefix}${row.label}`)).toEqual([
    '├ ✓ frame',
    '├ ✓ build',
    '├ ▶ review',
    '├ · fix',
    '├ · verify',
    '└ · ship',
  ])
})

test('the plan sits under the first step, and each log line under the step it names, as one line', () => {
  const text = `${SINGLE.replace('## Steps', '## Acceptance criteria\n- [x] index added\n- [ ] guards collapsed\n\n## Approach\nschema + service\n\n## Steps')}
## Log
- 2026-10-02 framed (autonomy granted). Long tail that should not show.
- 2026-10-02 build green, commit abc
- 2026-10-02 review launched: 2 Opus passes
- 2026-10-02 second opinion timed out
`
  const single = { ...parseWorkflow('x.md', text), updatedAt: 0 }
  const nodes = stepNodes(single, [])
  const parentOf = (label: string) => nodes.find(node => node.label.includes(label))?.parentId

  expect(parentOf('Plan · 1/2 criteria met')).toBe('x.md::frame')
  expect(parentOf('↳ schema + service')).toBe('x.md::plan')
  expect(nodes.find(node => node.label.includes('framed'))?.label).toBe('› framed (autonomy granted)')
  expect(parentOf('build green')).toBe('x.md::build')
  expect(parentOf('review launched')).toBe('x.md::review')
  expect(parentOf('second opinion')).toBe('x.md::review')
})

test('a recorded line becomes one sentence that fits a row', () => {
  expect(oneLine('2026-10-02 verify: 0 crit / 2 imp / 8 minor. Applying V1 and V2.')).toBe('verify: 0 crit / 2 imp / 8 minor')
  expect(oneLine('x'.repeat(200), 20)).toBe(`${'x'.repeat(19)}…`)
})

test('the ship step shows the PR as a link, its CI and what is left, instead of its log', () => {
  const url = 'https://github.com/acme/app/pull/845'
  const single = { ...parseWorkflow('x.md', `${SINGLE}\n## Log\n- 2026-10-02 shipped DRAFT PR ${url}\n`), updatedAt: 0 }
  const json = JSON.stringify({
    number: 845,
    url,
    state: 'OPEN',
    isDraft: true,
    reviewDecision: '',
    statusCheckRollup: [{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: '' }],
  })
  const pr = prStatusFrom(json, 0)
  const ship = shipNodes(single, pr ?? null)

  expect(single.prUrl).toBe(url)
  expect(ship.map(node => node.label)).toEqual([`[PR #845 · draft](${url})`, 'CI ● 1 of 2 running', 'Next: wait for CI'])
  expect(stepNodes(single, []).some(node => node.label.includes('shipped DRAFT'))).toBe(false)
  if (pr === undefined) return
  expect(ciLine({ ...pr, pending: 0 })).toBe('CI ✓ 1 passed')
  expect(nextAction({ ...pr, pending: 0 })).toBe('Next: review it, then mark it ready')
  expect(nextAction({ ...pr, pending: 0, failed: 1 })).toBe('Next: fix the failing checks')
})

test('another run with the same step names gets its own ids', () => {
  const a = stepNodes({ ...parseWorkflow('a.md', SINGLE), updatedAt: 0 }, [])
  const b = stepNodes({ ...parseWorkflow('b.md', SINGLE), updatedAt: 0 }, [])

  expect(a.some(one => b.some(other => other.id === one.id))).toBe(false)
})

test('a pgrep for a reviewer is not a reviewer launch', () => {
  expect(reviewerKind('sleep 5; pgrep -fl "second-opinion code-reviewer" | head -2')).toBe(undefined)
})

test('the log path expands variables, and liveness matches the run by its log token', () => {
  const command = 'S=/tmp/scratch && second-opinion code-reviewer "$S/inputs.md" /repo > $S/second-opinion.log 2>&1'

  expect(logToken(command)).toBe('$S/second-opinion.log')
  expect(logPath(command)).toBe('/tmp/scratch/second-opinion.log')
  expect(livenessPattern({ kind: 'second-opinion', label: 'second-opinion review', logToken: '$S/second-opinion.log' })).toBe(
    '\\$S/second-opinion\\.log',
  )
})

test('a reviewer log that ends in a quota or model error reads as a failure', () => {
  expect(failureLine('crit=0\nError: the review session failed (exit 1, error_max_turns)')).toBe(
    'Error: the review session failed (exit 1, error_max_turns)',
  )
  expect(failureLine('ERROR: {"type":"error","status":400}')).toBe('ERROR: {"type":"error","status":400}')
  expect(failureLine('No issues. The composite foreign key is wired correctly.')).toBe(undefined)
  expect(failureLine('\n\n')).toBe('exited without writing a review')
})

test('hiding finished agents keeps steps and a finished parent of a running child', () => {
  const step = { id: 'task:T', kind: 'step' as const, label: 'T', meta: '', isLive: false, tone: 'none' as const }
  const kept = withoutFinished([step, node('a', undefined, false), node('b', 'a'), node('c', undefined, false)])

  expect(kept.map(one => one.id)).toEqual(['task:T', 'a', 'b'])
})

test('each stack task shows its recorded fields, its own step checklist and its criteria', () => {
  const text = `${STACK.replace(
    '- [x] build · [x] review · [x] fix · [x] verify · [x] pr\n',
    '- [x] build · [x] review · [x] fix · [x] verify · [x] pr\n- **Branch:** lt/config\n- **Base:** origin/main\n- **PR:** https://github.com/acme/app/pull/1\n\n### Acceptance criteria\n- [x] config served\n',
  )}`
  const stack = { ...parseWorkflow('x.md', text), updatedAt: 0 }
  const task1 = 'x.md::Task 1 — Serve runtime config'
  const nodes = stepNodes(stack, [`${task1}/review`])
  const under = (parent: string) => nodes.filter(node => node.parentId === parent).map(node => `${node.kind}:${node.label}`)

  expect(under(task1)).toEqual([
    'note:Branch: lt/config',
    'note:PR: https://github.com/acme/app/pull/1',
    'note:✓ build',
    'step:✓ review',
    'note:✓ fix',
    'note:✓ verify',
    'note:✓ pr',
    'group:Criteria · 1/1 met',
  ])
})

test('the frame step links the state file and the lines framed above the first section', () => {
  const text = SINGLE.replace('# Vision view pane\n', '# Vision view pane\n\nScenario map: https://claude.ai/artifact/abc\n')
  const single = { ...parseWorkflow('docs/vision/x.md', text), updatedAt: 0 }
  const frame = stepNodes(single, []).filter(node => node.parentId === 'docs/vision/x.md::frame')

  expect(frame.map(node => node.label)).toEqual([
    '[State file · x.md](docs/vision/x.md)',
    '[Scenario map](https://claude.ai/artifact/abc)',
  ])
})

test('only a vision state file path is claimed, as a repo-relative path', () => {
  expect(stateFileOf('/repo/docs/vision/2026-10-02-x.md')).toBe('docs/vision/2026-10-02-x.md')
  expect(stateFileOf('/repo/docs/vision/plans/2026-10-02-x.md')).toBe(undefined)
  expect(stateFileOf('/repo/docs/flow/lean/2026-10-02-x.md')).toBe(undefined)
})
