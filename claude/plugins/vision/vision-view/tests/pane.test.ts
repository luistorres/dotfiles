import type { AgentInfo } from 'claude-code'
import { expect, mock, test, type Engine, type TestBody } from 'claude-code/testing'

import { STACK_LATER, STACK_START } from './fixtures'

const PANE = {
  plugin: 'vision-view',
  component: 'Pane',
  requestId: 'vision-view',
  props: {
    title: 'Vision',
    isFocused: true,
    bodyColumns: 64,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const notice = (taskId: string, status: string) =>
  `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>t-${taskId}</tool-use-id>\n<status>${status}</status>\n<summary>…</summary>\n</task-notification>`

type On = Parameters<TestBody>[1]

type World = {
  state: string
  mtimeMs: number
  agents: AgentInfo[]
  nextTaskId: string
  statuses: (string | undefined)[]
  isGhBroken: boolean
}

const ran = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

const stubs = (on: On, world: World) => {
  on('session.start', () => ({ cwd: '/repo' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', ($, e) => {
    if (e.argv[0] === 'git') return { value: ran('/repo/.git\n') }
    if (world.isGhBroken) return { deny: 'gh is not installed' }
    return { value: ran(JSON.stringify({ state: 'OPEN', isDraft: true, statusCheckRollup: [{ conclusion: 'SUCCESS' }] })) }
  })
  on('fs.list', () => ({
    value: [
      { name: '2026-01-05-ledger.md', kind: 'file', size: 1, isLink: false, mtimeMs: 1 },
      { name: 'plans', kind: 'dir', size: 0, isLink: false, mtimeMs: 1 },
    ],
  }))
  on('fs.stat', () => ({ value: { kind: 'file', size: world.state.length, mtimeMs: world.mtimeMs, isLink: false } }))
  on('fs.read', () => ({ value: world.state }))
  on('agent.list', () => ({ value: world.agents }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [{ id: 'vision-view', title: 'Vision', isShown: true, isFocused: true, isPlaced: true }] }))
  on('ui.status', ($, e) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('tool.call', ($, e) =>
    e.tool === 'Bash' && e.run_in_background === true
      ? { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: world.nextTaskId } }
      : { result: { stdout: '', stderr: '', interrupted: false } },
  )
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('classic.Stop', () => ({}))
  on('turn.complete', () => ({ text: '' }))
}

const command = (args: string) => ({
  command: 'vision-view',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

const begin = async ($: Engine) => {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run(command(''))
}

const shown = async ($: Engine, text: string | RegExp) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const found = await ui.find({ type: 'Text', text })
  await ui.unmount()
  return found !== undefined
}

test('the pane follows a stack from the state file and the host, and its clocks keep moving', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world: World = {
    state: STACK_START,
    mtimeMs: 1,
    agents: [{ id: 'a1', description: 'Review task 1', type: 'vision:code-reviewer', status: 'running' }],
    nextTaskId: 'bg1',
    statuses: [],
    isGhBroken: false,
  }
  stubs(on, world)

  await begin($)
  await $.tool.call({
    tool: 'Bash',
    command: 'second-opinion --model gpt code-reviewer /tmp/inputs.md /repo > /tmp/so.log 2>&1',
    description: 'GPT second opinion on task 1',
    run_in_background: true,
  })
  await $.tool.call({ tool: 'Bash', command: "sed -n '1,9p' SKILL.md | grep 'second-opinion [--model <model>] <reviewer>'" })
  await clock.advance(2000)

  expect(await shown($, '▶ Task 1: balance queries and limit checks')).toBe(true)
  expect(await shown($, '● GPT second opinion on task 1 · running 2s')).toBe(true)
  expect(await shown($, '● vision:code-reviewer · Review task 1 · running')).toBe(true)
  expect(await shown($, /sed -n|<model>/)).toBe(false)

  await clock.advance(60_000)
  expect(await shown($, '● GPT second opinion on task 1 · running 1m 2s')).toBe(true)

  await $.prompt.submit({ origin: { kind: 'task-notification' }, text: notice('bg1', 'completed'), wait: false })
  world.agents = [{ ...world.agents[0]!, status: 'completed' }]
  world.state = STACK_LATER
  world.mtimeMs = 2
  await clock.advance(2000)

  expect(await shown($, '✓ Task 1: balance queries and limit checks')).toBe(true)
  expect(await shown($, '▶ Task 2 — payment reissue')).toBe(true)
  expect(await shown($, '   build ✓  review ▶  fix ·  verify ·  drift ·  pr ·')).toBe(true)
  expect(await shown($, 'nothing right now')).toBe(true)
  expect(await shown($, '2 finished · h shows them')).toBe(true)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const link = await ui.find({ type: 'Link' })
  expect(link?.props).toMatchObject({ href: 'https://github.com/example-org/ledger/pull/62', label: 'PR #62 · draft · CI ✓ 1' })
  await ui.press({ key: 'ctl-finished' })
  expect(await ui.find({ type: 'Text', text: /^✓ GPT second opinion on task 1 · done after 1m 2s$/ })).toBeDefined()
  await ui.unmount()
})

test('a broken gh or a failing read never freezes the pane', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const world: World = { state: STACK_LATER, mtimeMs: 1, agents: [], nextTaskId: 'bg2', statuses: [], isGhBroken: true }
  stubs(on, world)

  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the api tests', run_in_background: true })
  await clock.advance(2000)
  await clock.advance(30_000)

  expect(await shown($, '● Run the api tests · running 32s')).toBe(true)
  expect(await shown($, '   PR #62')).toBe(false)
})

test('a background command missing from the end-of-turn list has ended even without its notice', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const world: World = { state: STACK_LATER, mtimeMs: 1, agents: [], nextTaskId: 'bg3', statuses: [], isGhBroken: false }
  stubs(on, world)

  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'npm run e2e', description: 'Run the e2e suite', run_in_background: true })
  await clock.advance(2000)
  expect(await shown($, '● waiting on 1 background job')).toBe(false)

  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(await shown($, '● waiting on 1 background job')).toBe(true)

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await clock.advance(2000)
  expect(await shown($, '● waiting for you')).toBe(true)
  expect(await shown($, '1 finished · h shows them')).toBe(true)
})

test('minimized, the status line names the task, the step and the work running', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const world: World = { state: STACK_LATER, mtimeMs: 1, agents: [], nextTaskId: 'bg4', statuses: [], isGhBroken: false }
  stubs(on, world)

  await begin($)
  await $.command.run(command('min'))
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests', run_in_background: true })
  await clock.advance(2000)

  expect(world.statuses.at(-1)).toBe('vision · task 2/2 review · 1 running')
})
