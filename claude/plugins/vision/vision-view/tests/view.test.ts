import { expect, test } from 'claude-code/testing'

import type { Job } from '../types'
import { backgroundTaskId, noticeOf, reconcile, settle, shellLabel } from '../hooks/jobs'
import { parseRun } from '../hooks/run'
import { paneLines, safeHref, statusText, type Snapshot } from '../hooks/view'
import { SINGLE, STACK_LATER, STACK_START } from './fixtures'

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

test('the attention line separates working, waiting for you and waiting on background work', () => {
  const live = [job('a', 'running', 0)]

  expect(texts(snapshot({ attention: 'working' }))).toContain('● working')
  expect(texts(snapshot({ attention: 'idle' }))).toContain('● waiting for you')
  expect(texts(snapshot({ attention: 'idle', jobs: live }))).toContain('● waiting on 1 background job')
  expect(texts(snapshot({ attention: 'asking', jobs: live }))).toContain('● waiting for you: a question or a permission prompt')
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

test('a task notification names the background task and how it ended', () => {
  const text = '<task-notification>\n<task-id>b7x</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>failed</status>\n</task-notification>'

  expect(noticeOf(text)).toEqual({ taskId: 'b7x', status: 'failed' })
  expect(noticeOf('<task-notification><status>completed</status></task-notification>')).toBe(undefined)
  expect(noticeOf('a message that only mentions <task-id>')).toBe(undefined)
})

test('a background command ends by its notice, or by missing from the in-flight list at the end of a turn', () => {
  const shells = [
    { ...job('one', 'running', 0), toolUseId: 't1' },
    { ...job('two', 'running', 0), toolUseId: 't2' },
  ]

  expect(settle(shells, { taskId: 'one', status: 'done' }, 50)[0]).toMatchObject({ status: 'done', endedAt: 50 })
  expect(reconcile(shells, new Set(['two']), 60).map(shell => shell.status)).toEqual(['ended', 'running'])
  expect(settle(reconcile(shells, new Set(), 60), { taskId: 'two', status: 'failed' }, 70)[1]).toMatchObject({
    status: 'failed',
    endedAt: 60,
  })
})

test('a background command is labelled by its description, else its first line', () => {
  expect(shellLabel('GPT second opinion on task 1', 'second-opinion …')).toBe('GPT second opinion on task 1')
  expect(shellLabel(undefined, '\n  npm test --silent\nmore')).toBe('npm test --silent')
  expect(backgroundTaskId({ stdout: '', backgroundTaskId: 'b1' })).toBe('b1')
  expect(backgroundTaskId({ stdout: 'x' })).toBe(undefined)
  expect(backgroundTaskId('text')).toBe(undefined)
})
