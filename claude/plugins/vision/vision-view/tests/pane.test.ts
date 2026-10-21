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
type Clock = ReturnType<typeof mock.clock>

type World = {
  state: string
  mtimeMs: number
  files: string[]
  agents: AgentInfo[]
  nextTaskId: string
  statuses: (string | undefined)[]
  opens: { rows?: number; focus?: true }[]
  isPlaced: boolean
  canPlace: boolean
  closes: number
  gh: 'ok' | 'broken' | 'slow'
  isReadBroken: boolean
  hangingReads: number
  isAgentListBroken: boolean
}

const world = (over: Partial<World> = {}): World => ({
  state: STACK_LATER,
  mtimeMs: 1,
  files: ['2026-01-05-ledger.md'],
  agents: [],
  nextTaskId: 'bg1',
  statuses: [],
  opens: [],
  isPlaced: true,
  canPlace: true,
  closes: 0,
  gh: 'ok',
  isReadBroken: false,
  hangingReads: 0,
  isAgentListBroken: false,
  ...over,
})

const ran = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

const stubs = (on: On, world: World, clock: Clock) => {
  on('session.start', () => ({ cwd: '/repo' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'git') return { value: ran('/repo/.git\n') }
    if (world.gh === 'broken') return { deny: 'gh is not installed' }
    if (world.gh === 'slow') await clock.sleep(60_000)
    return { value: ran(JSON.stringify({ state: 'OPEN', isDraft: true, statusCheckRollup: [{ conclusion: 'SUCCESS' }] })) }
  })
  on('fs.list', () => ({
    value: [
      ...world.files.map(name => ({ name, kind: 'file' as const, size: 1, isLink: false, mtimeMs: world.mtimeMs })),
      { name: 'plans', kind: 'dir' as const, size: 0, isLink: false, mtimeMs: 0 },
    ],
  }))
  on('fs.read', async () => {
    if (world.hangingReads > 0) {
      world.hangingReads -= 1
      await clock.sleep(600_000)
    }
    return world.isReadBroken ? { deny: 'the disk is busy' } : { value: world.state }
  })
  on('agent.list', () => (world.isAgentListBroken ? { deny: 'no agents here' } : { value: world.agents }))
  on('ui.open', ($, e) => {
    world.opens.push(e)
    return { value: world.canPlace ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'no-surface' } }
  })
  on('ui.close', () => {
    world.closes += 1
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [{ id: 'vision-view', title: 'Vision', isShown: true, isFocused: true, isPlaced: world.isPlaced }] }))
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
  on('classic.SessionStart', () => ({}))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
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

type Node = { type: string; props: Record<string, unknown>; children?: unknown[] }

const words = (node: unknown): string[] => {
  if (typeof node === 'string') return [node]
  if (typeof node !== 'object' || node === null) return []

  const { type, props, children = [] } = node as Node
  if (type === 'Button' || type === 'Link') return [String(props.label)]
  if (type === 'Text') return [children.flatMap(words).join('')]
  return children.flatMap(words)
}

const screen = async ($: Engine): Promise<string[]> => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const root = await ui.find({ type: 'Box' })
  await ui.unmount()
  return words(root).filter(one => one.trim() !== '')
}

const CONTROLS = ['show finished', 'minimize', 'close']

test('the pane follows a stack from the state file and the host, and its clocks keep moving', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const w = world({
    state: STACK_START,
    agents: [{ id: 'a1', description: 'Review task 1', type: 'vision:code-reviewer', status: 'running' }],
  })
  stubs(on, w, clock)

  await begin($)
  await $.tool.call({
    tool: 'Bash',
    command: 'second-opinion --model gpt code-reviewer /tmp/inputs.md /repo > /tmp/so.log 2>&1',
    description: 'GPT second opinion on task 1',
    run_in_background: true,
  })
  await $.tool.call({ tool: 'Bash', command: "sed -n '1,9p' SKILL.md | grep 'second-opinion [--model <model>] <reviewer>'" })
  await clock.advance(2000)

  const first = await screen($)
  expect(first.slice(0, 4)).toEqual(['vision · Reporting adapters for the ledger service', ...CONTROLS])
  expect(first).toEqual(
    expect.arrayContaining([
      '▶ Task 1: balance queries and limit checks',
      '● GPT second opinion on task 1 · running 2s',
      '● vision:code-reviewer · Review task 1 · running',
    ]),
  )
  expect(first.some(one => /sed -n|<model>/.test(one))).toBe(false)

  await clock.advance(60_000)
  expect(await screen($)).toContain('● GPT second opinion on task 1 · running 1m 2s')

  await $.prompt.submit({ origin: { kind: 'task-notification' }, text: notice('bg1', 'completed'), wait: false })
  w.agents = [{ ...w.agents[0]!, status: 'completed' }]
  w.state = STACK_LATER
  w.mtimeMs = 2
  await clock.advance(2000)
  await clock.advance(2000)

  expect(await screen($)).toEqual(
    expect.arrayContaining([
      '✓ Task 1: balance queries and limit checks',
      'PR #62 · draft · CI ✓ 1',
      '▶ Task 2 — payment reissue',
      '   build ✓  review ▶  fix ·  verify ·  drift ·  pr ·',
      'nothing right now',
      '2 finished · h shows them',
    ]),
  )

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Link' }))?.props).toMatchObject({ href: 'https://github.com/example-org/ledger/pull/62' })
  await ui.press({ key: 'ctl-finished' })
  expect(await ui.find({ type: 'Text', text: /^✓ GPT second opinion on task 1 · done after 1m 2s$/ })).toBeDefined()
  await ui.unmount()
})

test('a slow gh, a failing read or a failing agent list never stops the clock or the refresh', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ gh: 'slow', nextTaskId: 'bg2' })
  stubs(on, w, clock)

  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the api tests', run_in_background: true })
  await clock.advance(2000)
  expect(await screen($)).toContain('● Run the api tests · running 2s')

  w.isReadBroken = true
  w.isAgentListBroken = true
  w.state = STACK_START
  w.mtimeMs = 2
  await clock.advance(10_000)
  expect(await screen($)).toEqual(expect.arrayContaining(['● Run the api tests · running 12s', '▶ Task 2 — payment reissue']))

  w.isReadBroken = false
  await clock.advance(2000)
  expect(await screen($)).toContain('▶ Task 1: balance queries and limit checks')
})

test('a read that never answers holds the refresh back for twenty seconds at most, and the clock not at all', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ nextTaskId: 'bg5' })
  stubs(on, w, clock)

  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the api tests', run_in_background: true })
  w.hangingReads = 1
  w.state = STACK_START
  w.mtimeMs = 2
  await clock.advance(12_000)
  expect(await screen($)).toEqual(expect.arrayContaining(['● Run the api tests · running 12s', '▶ Task 2 — payment reissue']))

  await clock.advance(12_000)
  expect(await screen($)).toContain('▶ Task 1: balance queries and limit checks')
})

test('a background command missing from the end-of-turn list has ended even without its notice', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ nextTaskId: 'bg3' })
  stubs(on, w, clock)

  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'npm run e2e', description: 'Run the e2e suite', run_in_background: true })
  await clock.advance(2000)
  expect(await screen($)).toContain('● working')

  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(await screen($)).toContain('● waiting on 1 background job')

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await clock.advance(2000)
  expect(await screen($)).toEqual(expect.arrayContaining(['● waiting for you', '1 finished · h shows them']))
})

test('a subagent starting a turn does not make the main session look busy', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  stubs(on, world(), clock)

  await begin($)
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  await $.turn.start({ text: 'Review task 2', turnId: 't2', agentId: 'a1' })
  expect(await screen($)).toContain('● waiting for you')
})

test('a subagent resumed under its id shows how long it has run since, not since its first run', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ agents: [{ id: 'a1', description: 'Review task 2', type: 'vision:code-reviewer', status: 'completed' }] })
  stubs(on, w, clock)

  await begin($)
  await clock.advance(10_000)
  w.agents = [{ ...w.agents[0]!, status: 'running' }]
  await clock.advance(2000)
  await clock.advance(4000)
  expect(await screen($)).toContain('● vision:code-reviewer · Review task 2 · running 4s')
})

test('a subagent stays on screen after the engine stops listing it', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ agents: [{ id: 'a1', description: 'probe', type: 'Explore', status: 'running' }] })
  stubs(on, w, clock)

  await begin($)
  await clock.advance(2000)
  w.agents = [{ ...w.agents[0]!, status: 'completed' }]
  await clock.advance(4000)
  w.agents = []
  await clock.advance(4000)
  expect(await screen($)).toContain('1 finished · h shows them')

  await $.command.run(command('finished'))
  expect(await screen($)).toContain('✓ Explore · probe · done')
})

test('following the latest run again shows no run once none is left', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world()
  stubs(on, w, clock)

  await begin($)
  await $.command.run(command('attach ledger'))
  w.files = []
  await $.command.run(command('attach'))
  expect(await screen($)).toEqual(['No vision run in this checkout yet.', ...CONTROLS])
})

test('after /clear an open pane keeps following the run', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world()
  stubs(on, w, clock)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.classic.SessionStart({ source: 'clear' })
  w.state = STACK_START
  w.mtimeMs = 2
  await clock.advance(2000)
  expect(await screen($)).toContain('▶ Task 1: balance queries and limit checks')
})

test('a timer resizes the pane only while it is on screen and never opens it', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world()
  stubs(on, w, clock)

  await begin($)
  expect(w.opens.length).toBe(1)

  w.isPlaced = false
  w.state = STACK_LATER.replace('## Log', '## [ ] Task 3: audit export\n\n## Log')
  w.mtimeMs = 2
  await clock.advance(4000)
  expect(w.opens.length).toBe(1)

  w.isPlaced = true
  await clock.advance(2000)
  expect(w.opens.length).toBe(2)
  expect(w.opens[1]).toEqual({ id: 'vision-view', title: 'Vision', columns: 64, rows: (w.opens[0]?.rows ?? 0) + 1 })
})

test('where no pane can be placed the view falls back to the status line and says why', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ canPlace: false })
  stubs(on, w, clock)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  const reply = await $.command.run(command(''))

  expect(reply).toMatchObject({ text: expect.stringContaining('could not be placed (no-surface)') })
  expect(w.closes).toBe(1)
  expect(w.statuses.at(-1)).toBe('vision · task 2/2 review · waiting for you')
})

test('minimized, the status line names the task, the step and the work running', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ nextTaskId: 'bg4' })
  stubs(on, w, clock)

  await begin($)
  await $.command.run(command('min'))
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests', run_in_background: true })
  await clock.advance(2000)

  expect(w.statuses.at(-1)).toBe('vision · task 2/2 review · 1 running')
})
