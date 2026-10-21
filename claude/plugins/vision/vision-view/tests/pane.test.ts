import type { AgentInfo } from 'claude-code'
import { expect, mock, test, type Engine, type TestBody } from 'claude-code/testing'

import { ISSUES, STACK_LATER, STACK_START } from './fixtures'

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
  isOpenDenied: boolean
  isPaneListed: boolean
  canPlace: boolean
  closes: number
  gh: 'ok' | 'slow'
  isGitBroken: boolean
  gitExit: number
  gitCalls: number
  ghCalls: number
  listed: string[]
  hangingLists: number
  isDirGone: boolean
  isListBroken: boolean
  isReadBroken: boolean
  hangingReads: number
  isAgentListBroken: boolean
  answer: Promise<void>
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
  isOpenDenied: false,
  isPaneListed: true,
  canPlace: true,
  closes: 0,
  gh: 'ok',
  isGitBroken: false,
  gitExit: 0,
  gitCalls: 0,
  ghCalls: 0,
  listed: [],
  hangingLists: 0,
  isDirGone: false,
  isListBroken: false,
  isReadBroken: false,
  hangingReads: 0,
  isAgentListBroken: false,
  answer: Promise.resolve(),
  ...over,
})

const ran = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

const stubs = (on: On, world: World, clock: Clock) => {
  on('session.start', () => ({ cwd: '/repo' }))
  on('session.cwd', () => ({ value: '/repo/.worktrees/export' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'git') {
      world.gitCalls += 1
      if (world.isGitBroken) return { deny: 'git is not installed' }
      return { value: { ...ran(world.gitExit === 0 ? '/repo/.git\n' : ''), exitCode: world.gitExit } }
    }
    world.ghCalls += 1
    if (world.gh === 'slow') await clock.sleep(60_000)
    return { value: ran(JSON.stringify({ state: 'OPEN', isDraft: true, statusCheckRollup: [{ conclusion: 'SUCCESS' }] })) }
  })
  on('fs.list', async ($, e) => {
    world.listed.push(e.path ?? '')
    if (world.hangingLists > 0) {
      world.hangingLists -= 1
      await clock.sleep(600_000)
    }
    return world.isListBroken || world.isDirGone
      ? { deny: 'the disk is busy' }
      : {
          value: [
            ...world.files.map(name => ({ name, kind: 'file' as const, size: 1, isLink: false, mtimeMs: world.mtimeMs })),
            { name: 'plans', kind: 'dir' as const, size: 0, isLink: false, mtimeMs: 0 },
          ],
        }
  })
  on('fs.stat', () =>
    world.isDirGone ? { deny: 'no such directory' } : { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } },
  )
  on('fs.read', async () => {
    const answer = world.isReadBroken ? { deny: 'the disk is busy' } : { value: world.state }
    if (world.hangingReads > 0) {
      world.hangingReads -= 1
      await clock.sleep(600_000)
    }
    return answer
  })
  on('agent.list', () => (world.isAgentListBroken ? { deny: 'no agents here' } : { value: world.agents }))
  on('ui.open', ($, e) => {
    if (world.isOpenDenied) return { deny: 'the surface refuses panes' }
    world.opens.push(e)
    return { value: world.canPlace ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'no-surface' } }
  })
  on('ui.close', () => {
    world.closes += 1
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: world.isPaneListed ? [{ id: 'vision-view', title: 'Vision', isShown: true, isFocused: true, isPlaced: world.isPlaced }] : [],
  }))
  on('ui.status', ($, e) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('tool.call', async ($, e) => {
    if (e.tool === 'AskUserQuestion') await world.answer
    return e.tool === 'Bash' && e.run_in_background === true
      ? { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: world.nextTaskId } }
      : { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('classic.Stop', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('tool.check', () => ({ decision: 'ask' }))
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
  await $.command.run(command('pane'))
}

type Node = { type: string; props: Record<string, unknown>; children?: unknown[] }

const words = (node: unknown): string[] => {
  if (typeof node === 'string') return [node]
  if (typeof node !== 'object' || node === null) return []

  const { type, props, children = [] } = node as Node
  if (type === 'Link') return [String(props.label)]
  if (type === 'Text') return [children.flatMap(words).join('')]
  if (type === 'Box' && props.flexDirection === 'row' && children.length > 0 && children.every(child => (child as Node).type === 'Text')) return [children.flatMap(words).join('')]
  return children.flatMap(words)
}

const screen = async ($: Engine): Promise<string[]> => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const root = await ui.find({ type: 'Box' })
  await ui.unmount()
  return words(root).filter(one => one.trim() !== '')
}

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
  expect(first[0]).toBe('vision · Reporting adapters for the ledger service')
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
      '2 finished · /vision-view finished shows them',
    ]),
  )

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Link' }))?.props).toMatchObject({ href: 'https://github.com/example-org/ledger/pull/62' })
  await ui.unmount()

  await $.command.run(command('finished'))
  expect(await screen($)).toContain('✓ GPT second opinion on task 1 · done after 1m 2s')
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

  w.isListBroken = true
  await clock.advance(2000)
  expect(await screen($)).toContain('▶ Task 2 — payment reissue')

  w.isListBroken = false
  w.isReadBroken = false
  await clock.advance(2000)
  expect(await screen($)).toContain('▶ Task 1: balance queries and limit checks')
})

for (const failing of ['isReadBroken', 'isListBroken'] as const) {
  test(`a refresh overtaken by a newer one never puts older progress back on screen (${failing})`, async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const w = world()
    stubs(on, w, clock)

    await begin($)
    w.hangingReads = 1
    w.state = STACK_START
    w.mtimeMs = 2
    await clock.advance(12_000)
    w.state = ISSUES
    w.mtimeMs = 3
    await clock.advance(12_000)
    expect(await screen($)).toContain('vision · Onboarding checklist')

    w[failing] = true
    await clock.advance(600_000)
    expect(await screen($)).toContain('vision · Onboarding checklist')
  })
}

test('a read that never answers holds up neither the command nor the vision skill', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ hangingReads: 2 })
  stubs(on, w, clock)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.tool.call({ tool: 'Skill', skill: 'vision:vision' })
  const opening = $.command.run(command('pane'))
  await clock.advance(3000)
  expect(await opening).toMatchObject({ text: 'Vision view opened.' })
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

test('without git the runs are read from the session folder, and git is asked again until it answers', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ isGitBroken: true })
  stubs(on, w, clock)

  await begin($)
  expect(await screen($)).toContain('▶ Task 2 — payment reissue')
  expect(w.listed.at(-1)).toBe('/repo/.worktrees/export/docs/vision')

  w.isGitBroken = false
  await clock.advance(2000)
  expect(w.listed.at(-1)).toBe('/repo/docs/vision')
})

test('a read that never answers holds up no /clear, and a listing that never answers holds up no attach', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world()
  stubs(on, w, clock)

  await begin($)
  w.hangingReads = 1
  w.mtimeMs = 2
  await $.classic.SessionStart({ source: 'clear' })

  w.hangingLists = 1
  const attaching = $.command.run(command('attach ledger'))
  await clock.advance(3000)
  expect(await attaching).toMatchObject({ text: 'Could not list docs/vision just now; try again.' })
})

test('while a refresh is stalled the status line still follows the session', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ nextTaskId: 'bg7' })
  stubs(on, w, clock)

  await begin($)
  await $.command.run(command('min'))
  w.hangingReads = 1
  w.mtimeMs = 2
  await clock.advance(2000)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests', run_in_background: true })
  await clock.advance(2000)
  expect(w.statuses.at(-1)).toBe('vision · task 2/2 review · 1 running')
})

test('minimizing a closed view shows the run at once', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world()
  stubs(on, w, clock)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run(command('min'))
  expect(w.statuses.at(-1)).toBe('vision · task 2/2 review · waiting for you')
})

test('a vanished docs/vision folder means no run, while a failed listing of one still there keeps the run', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world()
  stubs(on, w, clock)

  await begin($)
  w.isListBroken = true
  await clock.advance(2000)
  expect(await screen($)).toContain('▶ Task 2 — payment reissue')

  w.isListBroken = false
  w.isDirGone = true
  await clock.advance(2000)
  expect(await screen($)).toContain('No vision run in this checkout yet.')
})

test('outside a repository git is asked once; a git that cannot run is asked again', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ gitExit: 128 })
  stubs(on, w, clock)

  await begin($)
  await clock.advance(6000)
  expect(w.gitCalls).toBe(1)
})

test('after /clear the PR badges are fetched again at once', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world()
  stubs(on, w, clock)

  await begin($)
  await clock.advance(2000)
  expect(w.ghCalls).toBe(1)

  await $.classic.SessionStart({ source: 'clear' })
  await clock.advance(2000)
  expect(w.ghCalls).toBe(2)
})

test('finished subagents beyond forty make room for new ones', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const agents = Array.from({ length: 45 }, (_, index) => ({ id: `a${index}`, description: `check ${index}`, type: 'Explore', status: 'completed' as const }))
  stubs(on, world({ agents }), clock)

  await begin($)
  await clock.advance(2000)
  expect(await screen($)).toContain('40 finished · /vision-view finished shows them')
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
  expect(await screen($)).toEqual(expect.arrayContaining(['● waiting for you', '1 finished · /vision-view finished shows them']))
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
  expect(await screen($)).toContain('1 finished · /vision-view finished shows them')

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
  expect(await screen($)).toEqual(['No vision run in this checkout yet.'])
})

for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`after a ${source} an open pane keeps following the run`, async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const w = world()
    stubs(on, w, clock)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
    await $.classic.SessionStart({ source })
    w.state = STACK_START
    w.mtimeMs = 2
    await clock.advance(2000)
    expect(await screen($)).toContain('▶ Task 1: balance queries and limit checks')
  })
}

test('after /clear with no pane up the status line is taken down rather than left to go stale', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ isPaneListed: false })
  stubs(on, w, clock)

  await begin($)
  await $.command.run(command('min'))
  await $.classic.SessionStart({ source: 'clear' })
  await clock.advance(4000)
  expect(w.statuses.at(-1)).toBe(undefined)
})

test('a reload keeps when the session started, so a run finished earlier in it stays on screen', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const w = world({ state: STACK_LATER.replace('Status: in_progress', 'Status: done'), mtimeMs: 1_005_000 })
  stubs(on, w, clock)

  await begin($)
  await clock.advance(10_000)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await clock.advance(2000)
  expect(await screen($)).toContain('✓ finished')
})

test('close takes the pane and the status line down and stops refreshing', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world()
  stubs(on, w, clock)

  await begin($)
  await $.command.run(command('min'))
  expect(w.statuses.at(-1)).toBe('vision · task 2/2 review · waiting for you')

  await $.command.run(command('close'))
  expect(w.statuses.at(-1)).toBe(undefined)

  w.state = STACK_START
  w.mtimeMs = 2
  await clock.advance(4000)
  expect(await screen($)).toContain('▶ Task 2 — payment reissue')
  expect(w.statuses.at(-1)).toBe(undefined)
})

test('running /vision-view pane while the pane is up opens it again, closing nothing and asking for no keyboard', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world()
  stubs(on, w, clock)

  await begin($)
  await $.command.run(command('pane'))
  expect(w.closes).toBe(0)
  expect(w.opens.length).toBe(2)
  expect(w.opens.some(one => 'focus' in one)).toBe(false)
})

test('the current step is drawn orange and bold, and the strip still reads whole', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  stubs(on, world({ state: STACK_START }), clock)

  await begin($)
  expect(await screen($)).toContain('   build ✓  review ▶  fix ·  verify ·  pr ·')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^review$/ }))?.props).toMatchObject({ color: '#FF8700', bold: true })
  expect((await ui.find({ type: 'Text', text: /^ ▶$/ }))?.props).toMatchObject({ color: '#FF8700', bold: true })
  await ui.unmount()
})

test('the pane is read-only: no button, and as many rows as lines', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ files: [] })
  stubs(on, w, clock)

  await begin($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
  expect(w.opens[0]?.rows).toBe(1)
})

test('/vision-view alone shows the status line, and /vision-view pane opens the pane', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world()
  stubs(on, w, clock)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run(command(''))
  expect(w.statuses.at(-1)).toBe('vision · task 2/2 review · waiting for you')
  expect(w.opens).toEqual([])

  await $.command.run(command('pane'))
  expect(w.opens.length).toBe(1)
  expect(w.statuses.at(-1)).toBe(undefined)
})

test('a command whose work throws still answers, and leaves the status line running', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world()
  stubs(on, w, clock)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run(command('min'))
  w.isOpenDenied = true
  expect(await $.command.run(command('pane'))).toMatchObject({ text: expect.stringMatching(/^vision-view: .+/) })

  w.state = STACK_START
  w.mtimeMs = 2
  await clock.advance(2000)
  expect(w.statuses.at(-1)).toBe('vision · task 1/2 review · waiting for you')
})

test('a permission dialog, which hides the pane while it is up, never leaves it saying it waits for an answer', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  stubs(on, world(), clock)

  await begin($)
  await $.turn.start({ text: 'clean the build', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'tu-rm' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  expect(await screen($)).toContain('● working')
})

test('a question waits for an answer until it is answered', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  let answered = () => {}
  const w = world({ answer: new Promise(resolve => (answered = resolve)) })
  stubs(on, w, clock)

  await begin($)
  const asking = $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  await clock.advance(2000)
  expect(await screen($)).toContain('● waiting for your answer')

  answered()
  await asking
  expect(await screen($)).toContain('● working')
})

test('only background commands the main session starts become jobs', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world({ nextTaskId: 'bg6' })
  stubs(on, w, clock)

  await begin($)
  const subagentCall = $.tool.call as (input: object) => Promise<unknown>
  await subagentCall({ tool: 'Bash', command: 'npm test', description: 'Tests a subagent started', run_in_background: true, agentId: 'a1' })
  await clock.advance(2000)
  expect((await screen($)).some(one => one.includes('Tests a subagent started'))).toBe(false)
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
  const reply = await $.command.run(command('pane'))

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
