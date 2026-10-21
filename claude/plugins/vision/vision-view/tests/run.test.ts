import { expect, test } from 'claude-code/testing'

import { isFinished, parseRun, pick, position } from '../hooks/run'
import { ISSUES, SINGLE, STACK_LATER, STACK_START } from './fixtures'

test('a single run reads as one task with its steps, criteria and the place it is at', () => {
  const run = parseRun('docs/vision/a.md', SINGLE)

  expect(run).toMatchObject({ title: 'Export invoices as CSV', status: 'in_progress', shape: 'single', risk: 'standard', isAutonomous: true })
  expect(run.tasks.length).toBe(1)
  expect(run.tasks[0]?.steps.map(step => step.label)).toEqual(['frame', 'build', 'review', 'fix', 'verify', 'ship'])
  expect(run.tasks[0]?.criteria.filter(one => one.isDone).length).toBe(1)
  expect(run.tasks[0]?.branch).toBe('lt/export-csv')
  expect(position(run)?.step?.label).toBe('review')
  expect(run.log).toEqual(['framed: standard; design settled', 'built: 4 files, tests green'])
})

test('a stack reads each task from its heading, step line, fields and criteria, whatever separates its title', () => {
  const run = parseRun('docs/vision/b.md', STACK_LATER.replace(/\n/g, '\r\n'))

  expect(run.shape).toBe('stack')
  expect(run.tasks.map(task => task.title)).toEqual(['Task 1: balance queries and limit checks', 'Task 2 — payment reissue'])
  expect(run.tasks[0]).toMatchObject({ isDone: true, pr: 'https://github.com/example-org/ledger/pull/62', branch: 'lt/ledger-balances' })
  expect(run.tasks[1]?.steps.map(step => step.label)).toEqual(['build', 'review', 'fix', 'verify', 'drift', 'pr'])
  expect(run.tasks[1]?.criteria).toEqual([{ label: 'A reissue keeps the original reference.', isDone: false }])
  expect(position(run)).toMatchObject({ index: 1, step: { label: 'review' } })
})

test('an empty PR field is no pull request, and an empty field never takes the next line', () => {
  const blankAbovePr = STACK_LATER.replace(
    '- **PR:** https://github.com/example-org/ledger/pull/62',
    '- **Implementer:**\n- **PR:** https://github.com/example-org/ledger/pull/62',
  )

  expect(parseRun('docs/vision/b.md', STACK_START).tasks[0]?.pr).toBe(null)
  expect(parseRun('docs/vision/b.md', blankAbovePr).tasks[0]?.pr).toBe('https://github.com/example-org/ledger/pull/62')
})

test('an issue set lists its issues without steps', () => {
  const run = parseRun('docs/vision/c.md', ISSUES)

  expect(run.shape).toBe('issues')
  expect(run.tasks.map(task => [task.title, task.isDone])).toEqual([
    ['1. Invite flow', true],
    ['2. Welcome email', false],
  ])
})

test('a run is finished when its status says so or every task is ticked', () => {
  expect(isFinished(parseRun('x', STACK_LATER))).toBe(false)
  expect(isFinished(parseRun('x', STACK_LATER.replace('Status: in_progress', 'Status: done')))).toBe(true)
  expect(isFinished(parseRun('x', SINGLE.replace(/\[ \]/g, '[x]')))).toBe(true)
})

const candidate = (path: string, mtimeMs: number, status: string) => ({
  path,
  mtimeMs,
  run: parseRun(path, SINGLE.replace('Status: in_progress', `Status: ${status}`)),
})

test('the run on screen is the attached one, else the in-progress run edited last, else one finished this session', () => {
  const older = candidate('docs/vision/older.md', 10, 'in_progress')
  const newer = candidate('docs/vision/newer.md', 20, 'in_progress')
  const done = candidate('docs/vision/done.md', 30, 'done')
  const notes = { path: 'docs/vision/notes.md', mtimeMs: 40, run: parseRun('docs/vision/notes.md', '# Notes\n') }

  expect(pick([older, newer, done, notes], null, 0)).toEqual({ chosen: newer, others: 1 })
  expect(pick([older, newer, done], 'docs/vision/older.md', 0)).toEqual({ chosen: older, others: 1 })
  expect(pick([done, notes], null, 25).chosen).toBe(done)
  expect(pick([done], null, 35).chosen).toBe(undefined)
})
