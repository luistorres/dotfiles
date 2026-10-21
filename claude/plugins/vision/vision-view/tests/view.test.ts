import { expect, test } from 'claude-code/testing'

import type { Job } from '../types'
import { agentJobs, agentTimes, backgroundTaskId, keepJobs, noticesOf, reconcile, settle, shellLabel } from '../hooks/jobs'
import { parseRun } from '../hooks/run'
import { paneLines, safeHref, statusText, type Snapshot } from '../hooks/view'
import { ISSUES, SINGLE, STACK_LATER, STACK_START } from './fixtures'

const job = (id: string, status: Job['status'], startedAt: number | null, endedAt: number | null = null): Job => ({
  id,
  label: `job ${id}`,
  status,
  startedAt,
  endedAt,
})

const snapshot = (over: Partial<Snapshot>): Snapshot => ({
  run: parseRun('docs/vision/b.md', STACK_LATER),
  otherRuns: 0,
  jobs: [],
  prs: {},
  attention: 'working',
  isShowingFinished: false,
  now: 100_000,
  ...over,
})

const texts = (data: Snapshot) => paneLines(data).map(line => line.text)

test('a stack shows each task once, the current one with its steps, and the shipped one with its PR', () => {
  const lines = paneLines(snapshot({}))
  const text = lines.map(line => line.text)

  expect(text).toContain('vision · Reporting adapters for the ledger service')
  expect(text).toContain('1 of 2 tasks done · task 2 at review · standard risk')
  expect(text).toContain('✓ Task 1: balance queries and limit checks')
  expect(text).toContain('▶ Task 2 — payment reissue')
  expect(text).toContain('   build ✓  review ▶  fix ·  verify ·  drift ·  pr ·')
  expect(text).toContain('   criteria 0/1 met')
  expect(lines.find(line => line.text === '   PR #62')?.href).toBe('https://github.com/example-org/ledger/pull/62')
  expect(text.filter(one => one.includes('Task 2')).length).toBe(1)
})

test('running work shows how long it has run, and finished work collapses into a count', () => {
  const jobs = [job('a', 'running', 40_000), job('b', 'done', 10_000, 20_000), job('c', 'failed', 10_000, 30_000)]

  expect(texts(snapshot({ jobs }))).toEqual(
    expect.arrayContaining(['● job a · running 1m 0s', '2 finished, 1 failed or stopped · h shows them']),
  )
  expect(texts(snapshot({ jobs, isShowingFinished: true }))).toEqual(
    expect.arrayContaining(['Finished', '✓ job b · done after 10s', '✗ job c · failed after 20s']),
  )
})

test('finished jobs beyond the ones shown are counted as earlier ones, with their own failures', () => {
  const jobs = Array.from({ length: 10 }, (_, index) => job(`f${index}`, index === 0 ? 'failed' : 'done', 0, 1000))

  const shown = texts(snapshot({ jobs, isShowingFinished: true }))
  expect(shown.indexOf('2 earlier finished, 1 failed or stopped')).toBe(shown.indexOf('Finished') + 1)
  expect(texts(snapshot({ jobs: jobs.slice(1), isShowingFinished: true }))).toContain('1 earlier finished')
  expect(texts(snapshot({ jobs }))).toContain('10 finished, 1 failed or stopped · h shows them')
})

test('an issue set lists each issue with the next one marked', () => {
  const text = texts(snapshot({ run: parseRun('docs/vision/c.md', ISSUES), attention: 'idle' }))

  expect(text).toEqual(
    expect.arrayContaining(['vision · Onboarding checklist', '1 of 2 issues done', '✓ 1. Invite flow', '▶ 2. Welcome email']),
  )
})

test('the attention line separates working, waiting for you and waiting on background work', () => {
  const live = [job('a', 'running', 0)]

  expect(texts(snapshot({ attention: 'working' }))).toContain('● working')
  expect(texts(snapshot({ attention: 'idle' }))).toContain('● waiting for you')
  expect(texts(snapshot({ attention: 'idle', jobs: live }))).toContain('● waiting on 1 background job')
  expect(texts(snapshot({ attention: 'asking', jobs: live }))).toContain('● waiting for your answer')
  expect(texts(snapshot({ run: parseRun('x', STACK_LATER.replace('Status: in_progress', 'Status: done')) }))).toContain('✓ finished')
})

test('the status line names the place, the work running and whether you are needed', () => {
  expect(statusText(snapshot({ jobs: [job('a', 'running', 0)] }))).toBe('vision · task 2/2 review · 1 running')
  expect(statusText(snapshot({ run: parseRun('x', SINGLE), attention: 'idle' }))).toBe('vision · review · waiting for you')
  expect(statusText(snapshot({ run: null }))).toBe('vision · no run yet')
})

test('a single run shows its steps without a task list', () => {
  const text = texts(snapshot({ run: parseRun('x', SINGLE) }))

  expect(text).toContain('frame ✓  build ✓  review ▶  fix ·  verify ·  ship ·')
  expect(text).toContain('criteria 1/2 met')
  expect(text).toContain('at review · standard risk · autonomous')
})

test('a link is drawn only for a URL written exactly as the URL parser spells it', () => {
  expect(safeHref('https://github.com/o/r/pull/1')).toBe('https://github.com/o/r/pull/1')
  expect(safeHref('https://GitHub.com/o/r/pull/1')).toBe(undefined)
  expect(safeHref('http://github.com/o/r/pull/1')).toBe(undefined)
  expect(safeHref('not a url')).toBe(undefined)
})

test('other runs in progress are mentioned, and no run at all says so', () => {
  expect(texts(snapshot({ otherRuns: 2 }))).toContain('2 other runs in progress · /vision-view attach <name>')
  expect(texts(snapshot({ run: null }))).toEqual(['No vision run in this checkout yet.'])
  expect(texts(snapshot({ run: parseRun('x', STACK_START) }))).toContain('0 of 2 tasks done · task 1 at review · standard risk')
})

test('a task notification names each background task it reports and how it ended', () => {
  const one = '<task-notification>\n<task-id>b7x</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>failed</status>\n</task-notification>'
  const two = `${one}\n<task-notification><task-id>b8y</task-id><status>completed</status></task-notification>`

  expect(noticesOf(one)).toEqual([{ taskId: 'b7x', status: 'failed' }])
  expect(noticesOf(two)).toEqual([
    { taskId: 'b7x', status: 'failed' },
    { taskId: 'b8y', status: 'done' },
  ])
  expect(noticesOf('<task-notification><status>completed</status></task-notification>')).toEqual([])
  expect(noticesOf('a message that only mentions <task-id>')).toEqual([])
})

test('a background command ends by its notice, or by missing from the in-flight list at the end of a turn', () => {
  const shells = [job('one', 'running', 0), job('two', 'running', 0)]

  expect(settle(shells, [{ taskId: 'one', status: 'done' }], 50)[0]).toMatchObject({ status: 'done', endedAt: 50 })
  expect(reconcile(shells, new Set(['two']), 60).map(shell => shell.status)).toEqual(['ended', 'running'])
  expect(settle(reconcile(shells, new Set(), 60), [{ taskId: 'two', status: 'failed' }], 70)[1]).toMatchObject({
    status: 'failed',
    endedAt: 60,
  })
})

test('only finished commands make room for new ones', () => {
  const shells = [job('old', 'running', 0), job('done', 'done', 1, 2), job('new', 'running', 3)]

  expect(keepJobs(shells, 2).map(shell => shell.id)).toEqual(['old', 'new'])
  expect(keepJobs(shells, 1).map(shell => shell.id)).toEqual(['old', 'new'])
  expect(keepJobs(shells, 5).length).toBe(3)
})

test('a subagent resumed under the same id starts its clock again', () => {
  const agents = [
    { id: 'a1', description: 'Review', type: 'vision:code-reviewer', status: 'running' },
    { id: 'a2', description: 'Fix', type: 'general-purpose', status: 'completed' },
  ]

  expect(agentTimes(agents, [], {}, 10)).toEqual({ started: {}, ended: { a2: 10 }, resumed: [] })
  expect(agentTimes(agents, [], { a1: 5, a2: 5 }, 20)).toEqual({ started: { a1: 20 }, ended: {}, resumed: ['a1'] })
})

test('a subagent the engine stops listing stays on screen, ended if it was still running', () => {
  const known = [job('gone-running', 'running', 0), job('gone-done', 'done', 0, 30), job('listed', 'running', 0)]
  const agents = [{ id: 'listed', description: 'Fix', type: 'general-purpose', status: 'running' }]
  const times = agentTimes(agents, known, { 'gone-done': 30 }, 50)

  expect(times.ended).toEqual({ 'gone-running': 50 })
  expect(agentJobs(agents, known, { listed: 0 }, { ...times.ended, 'gone-done': 30 })).toEqual([
    { ...job('gone-running', 'ended', 0, 50) },
    job('gone-done', 'done', 0, 30),
    { id: 'listed', label: 'general-purpose · Fix', status: 'running', startedAt: 0, endedAt: null },
  ])
})

test('a background command is labelled by its description, else its first line', () => {
  expect(shellLabel('GPT second opinion on task 1', 'second-opinion …')).toBe('GPT second opinion on task 1')
  expect(shellLabel(undefined, '\n  npm test --silent\nmore')).toBe('npm test --silent')
  expect(backgroundTaskId({ stdout: '', backgroundTaskId: 'b1' })).toBe('b1')
  expect(backgroundTaskId({ stdout: 'x' })).toBe(undefined)
  expect(backgroundTaskId('text')).toBe(undefined)
})
