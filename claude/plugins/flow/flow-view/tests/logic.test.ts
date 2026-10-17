import { expect, test } from 'claude-code/testing'

import { failureLine, livenessPattern, logPath, logToken, pullRequestUrl, reviewCycle, reviewerKind } from '../hooks/reviewers'
import { flatten, shipNodes, stepAnchor, stepNodes, withoutFinished } from '../hooks/tree'
import { ciLine, nextAction, prStatusFrom } from '../hooks/pr'
import { currentStep, isInProgress, oneLine, parseWorkflow, stateFileOf } from '../hooks/workflow'
import type { Reviewer } from '../types'

const LEAN = `---
Status: in_progress
Kind: lean
Branch: lt/flow-view
---
# Flow view pane

## Steps
- [x] 1 frame · [x] 2 build · [ ] 3 trace (x2) · [ ] 3f fix round · [ ] 4 ship
`

const FLOW = `# Tasks: Production bring-up

Status: in_progress
Current: 2 / 3 (PR open, draft)

## [x] Task 1 — Serve runtime config
- [x] 3a worktree · [x] 3b SDD · [x] 3c agents-review · [x] 3d pr-create

## [ ] Task 2 — Write the runbook
- [x] 3a worktree · [x] 3b SDD · [ ] 3c agents-review (3 reviewers, converged) · [ ] 3d pr-create

## [ ] Task 3 — Wire the app spec
`

const node = (id: string, parentId?: string, isLive = true) => ({ id, parentId, kind: 'agent' as const, label: id, meta: '', isLive, tone: 'none' as const })

test('a lean state file reads its branch and stops at the first unticked step', () => {
  const lean = parseWorkflow('lean', 'x.md', LEAN)

  expect(isInProgress(LEAN)).toBe(true)
  expect(lean.title).toBe('Flow view pane')
  expect(lean.headline).toBe('lt/flow-view')
  expect(lean.steps.map(step => step.label)).toEqual(['1 frame', '2 build', '3 trace (x2)', '3f fix round', '4 ship'])
  expect(currentStep(lean.steps)?.label).toBe('3 trace (x2)')
})

test('a flow tasks file reads the current task and its own step checklist', () => {
  const flow = parseWorkflow('flow', 'x-tasks.md', FLOW)

  expect(flow.title).toBe('Production bring-up')
  expect(flow.headline).toBe('2 / 3 (PR open, draft)')
  expect(currentStep(flow.steps)?.label).toBe('Task 2 — Write the runbook')
  expect(currentStep(flow.substeps)?.label).toBe('3c agents-review (3 reviewers, converged)')
})

test('a done state file is not in progress', () => {
  expect(isInProgress(LEAN.replace('in_progress', 'done'))).toBe(false)
})

test('codex and cursor launches are recognised with their log file', () => {
  const codex = 'stdbuf -oL codex exec --model gpt-6.1-sol "$(< /tmp/p.txt)" </dev/null > /tmp/codex-review.log 2>&1'

  expect(reviewerKind(codex)).toBe('codex')
  expect(logPath(codex)).toBe('/tmp/codex-review.log')
  expect(reviewerKind('agent --print --trust --mode ask --model grok-4.7-high "x"')).toBe('cursor')
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
  const launched = [launch('codex', 5), launch('codex', 20), launch('cursor', 20), launch('codex', 40), launch('cursor', 41)]

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
  const flow = { ...parseWorkflow('flow', 'x-tasks.md', FLOW), updatedAt: 0 }
  const anchor = stepAnchor(flow)
  const steps = stepNodes(flow, [anchor ?? '', 'x-tasks.md::Task 1 — Serve runtime config/3b SDD'])
  const rows = flatten([...steps, node('impl', anchor)], new Set())

  expect(anchor).toBe('x-tasks.md::Task 2 — Write the runbook/3c agents-review (3 reviewers, converged)')
  expect(rows.map(row => `${row.prefix}${row.label}`)).toEqual([
    '├ ✓ Task 1 — Serve runtime config',
    '├ ▶ Task 2 — Write the runbook',
    '│ ├ ✓ 3a worktree',
    '│ ├ ✓ 3b SDD',
    '│ ├ ▶ 3c agents-review (3 reviewers, converged)',
    '│ │ └ impl',
    '│ └ · 3d pr-create',
    '└ · Task 3 — Wire the app spec',
  ])
})

test('lean sub-steps nest under their numbered step', () => {
  const lean = { ...parseWorkflow('lean', 'x.md', LEAN), updatedAt: 0 }
  const rows = flatten(stepNodes(lean, []), new Set())

  expect(rows.map(row => `${row.prefix}${row.label}`)).toEqual([
    '├ ✓ 1 frame',
    '├ ✓ 2 build',
    '├ ▶ 3 trace (x2)',
    '│ └ · 3f fix round',
    '└ · 4 ship',
  ])
})

test('the plan sits under the first step, and each log line under the step it names, as one line', () => {
  const text = `${LEAN.replace('## Steps', '## Acceptance criteria\n- [x] index added\n- [ ] guards collapsed\n\n## Approach\nschema + service\n\n## Steps')}
## Log
- 2026-10-02 framed (autonomy granted). Long tail that should not show.
- 2026-10-02 build green, commit abc
- 2026-10-02 [3] launched: 2 Opus passes
- 2026-10-02 Sol seat quota out
`
  const lean = { ...parseWorkflow('lean', 'x.md', text), updatedAt: 0 }
  const nodes = stepNodes(lean, [])
  const parentOf = (label: string) => nodes.find(node => node.label.includes(label))?.parentId

  expect(parentOf('Plan · 1/2 criteria met')).toBe('x.md::1 frame')
  expect(parentOf('↳ schema + service')).toBe('x.md::plan')
  expect(nodes.find(node => node.label.includes('framed'))?.label).toBe('› framed (autonomy granted)')
  expect(parentOf('build green')).toBe('x.md::2 build')
  expect(parentOf('[3] launched')).toBe('x.md::3 trace (x2)')
  expect(parentOf('Sol seat')).toBe('x.md::3 trace (x2)')
})

test('a recorded line becomes one sentence that fits a row', () => {
  expect(oneLine('2026-10-02 verify: 0 crit / 2 imp / 8 minor. Applying V1 and V2.')).toBe('verify: 0 crit / 2 imp / 8 minor')
  expect(oneLine('x'.repeat(200), 20)).toBe(`${'x'.repeat(19)}…`)
})

test('the ship step shows the PR as a link, its CI and what is left, instead of its log', () => {
  const url = 'https://github.com/acme/app/pull/845'
  const lean = { ...parseWorkflow('lean', 'x.md', `${LEAN}\n## Log\n- 2026-10-02 shipped DRAFT PR ${url}\n`), updatedAt: 0 }
  const json = JSON.stringify({
    number: 845,
    url,
    state: 'OPEN',
    isDraft: true,
    reviewDecision: '',
    statusCheckRollup: [{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: '' }],
  })
  const pr = prStatusFrom(json, 0)
  const ship = shipNodes(lean, pr ?? null)

  expect(lean.prUrl).toBe(url)
  expect(ship.map(node => node.label)).toEqual([`[PR #845 · draft](${url})`, 'CI ● 1 of 2 running', 'Next: wait for CI'])
  expect(stepNodes(lean, []).some(node => node.label.includes('shipped DRAFT'))).toBe(false)
  if (pr === undefined) return
  expect(ciLine({ ...pr, pending: 0 })).toBe('CI ✓ 1 passed')
  expect(nextAction({ ...pr, pending: 0 })).toBe('Next: review it, then mark it ready')
  expect(nextAction({ ...pr, pending: 0, failed: 1 })).toBe('Next: fix the failing checks')
})

test('another run with the same step names gets its own ids', () => {
  const a = stepNodes({ ...parseWorkflow('lean', 'a.md', LEAN), updatedAt: 0 }, [])
  const b = stepNodes({ ...parseWorkflow('lean', 'b.md', LEAN), updatedAt: 0 }, [])

  expect(a.some(one => b.some(other => other.id === one.id))).toBe(false)
})

test('a pgrep for a reviewer is not a reviewer launch', () => {
  expect(reviewerKind('sleep 5; pgrep -fl "codex exec" | head -2; pgrep -fl "agent --print"')).toBe(undefined)
})

test('the log path expands variables, and liveness matches the run by its log token', () => {
  const command = 'S=/tmp/scratch && agent --print --model grok-4.7-high "$(< $S/p.txt)" </dev/null > $S/cursor-review.log 2>&1'

  expect(logToken(command)).toBe('$S/cursor-review.log')
  expect(logPath(command)).toBe('/tmp/scratch/cursor-review.log')
  expect(livenessPattern({ kind: 'cursor', label: 'cursor review · grok-4.7-high', logToken: '$S/cursor-review.log' })).toBe(
    '\\$S/cursor-review\\.log',
  )
})

test('a reviewer log that ends in a quota or model error reads as a failure', () => {
  expect(failureLine('cursor-retrieval: tracing\nActionRequiredError: You\'ve hit your usage limit')).toBe(
    "ActionRequiredError: You've hit your usage limit",
  )
  expect(failureLine('ERROR: {"type":"error","status":400}')).toBe('ERROR: {"type":"error","status":400}')
  expect(failureLine('No issues. The composite foreign key is wired correctly.')).toBe(undefined)
  expect(failureLine("cursor-retrieval: tracing to '/tmp/x.log'\n")).toBe('exited without writing a review')
})

test('hiding finished agents keeps steps and a finished parent of a running child', () => {
  const step = { id: 'task:T', kind: 'step' as const, label: 'T', meta: '', isLive: false, tone: 'none' as const }
  const kept = withoutFinished([step, node('a', undefined, false), node('b', 'a'), node('c', undefined, false)])

  expect(kept.map(one => one.id)).toEqual(['task:T', 'a', 'b'])
})

test('each flow task shows its recorded fields, its own step checklist and its criteria', () => {
  const text = `${FLOW.replace(
    '- [x] 3a worktree · [x] 3b SDD · [x] 3c agents-review · [x] 3d pr-create\n',
    '- [x] 3a worktree · [x] 3b SDD · [x] 3c agents-review · [x] 3d pr-create\n\n- **PR:** https://github.com/acme/app/pull/1\n- **Review cycles:** 1 / 3\n- **Depends on:** none\n\n### Acceptance criteria\n- [x] config served\n',
  )}`
  const flow = { ...parseWorkflow('flow', 'x-tasks.md', text), updatedAt: 0 }
  const task1 = 'x-tasks.md::Task 1 — Serve runtime config'
  const nodes = stepNodes(flow, [`${task1}/3b SDD`])
  const under = (parent: string) => nodes.filter(node => node.parentId === parent).map(node => `${node.kind}:${node.label}`)

  expect(under(task1)).toEqual([
    'note:PR: https://github.com/acme/app/pull/1',
    'note:Review cycles: 1 / 3',
    'note:✓ 3a worktree',
    'step:✓ 3b SDD',
    'note:✓ 3c agents-review',
    'note:✓ 3d pr-create',
    'group:Criteria · 1/1 met',
  ])
})

test('the frame step links the state file and the lines framed above the first section', () => {
  const text = LEAN.replace('# Flow view pane\n', '# Flow view pane\n\nScenario map: https://claude.ai/artifact/abc\n')
  const lean = { ...parseWorkflow('lean', 'docs/flow/lean/x.md', text), updatedAt: 0 }
  const frame = stepNodes(lean, []).filter(node => node.parentId === 'docs/flow/lean/x.md::1 frame')

  expect(frame.map(node => node.label)).toEqual([
    '[State file · x.md](docs/flow/lean/x.md)',
    '[Scenario map](https://claude.ai/artifact/abc)',
  ])
})

test('only a flow or lean-flow state file path is claimed, as a repo-relative path', () => {
  expect(stateFileOf('/repo/docs/flow/lean/2026-10-02-x.md')).toBe('docs/flow/lean/2026-10-02-x.md')
  expect(stateFileOf('/repo/docs/flow/plans/2026-10-02-x-tasks.md')).toBe('docs/flow/plans/2026-10-02-x-tasks.md')
  expect(stateFileOf('/repo/docs/flow/plans/2026-10-02-x.md')).toBe(undefined)
  expect(stateFileOf('/repo/docs/flow/specs/x.md')).toBe(undefined)
})
