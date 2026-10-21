import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Job, Run } from '../types'
import { agentJobs, agentTimes, backgroundTaskId, keepJobs, noticesOf, reconcile, settle, shellLabel } from './jobs'
import { prStatusFrom } from './pr'
import { parseRun, pick, type Candidate } from './run'
import { paneLines, statusText, type Line, type Snapshot, type Tone } from './view'

type $ = EngineInterface
type Ui = ReturnType<$['ui']['resolve']>

const PANE = 'vision-view'
const STATE_DIR = 'docs/vision'
const TICK_MS = 2000
const STUCK_MS = 20_000
const COMMAND_WAIT_MS = 3000
const PR_STALE_MS = 60_000
const MAX_ROWS = 40
const JOBS_KEPT = 40
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const VISION_SKILL = /(?:^|:)vision$/

const modeAtom = atom({ plugin: 'vision-view', key: 'mode' } as const, 'closed')
const checkoutAtom = atom({ plugin: 'vision-view', key: 'checkout' } as const, null)
const pinnedAtom = atom({ plugin: 'vision-view', key: 'pinned' } as const, null)
const runAtom = atom({ plugin: 'vision-view', key: 'run' } as const, null)
const otherRunsAtom = atom({ plugin: 'vision-view', key: 'otherRuns' } as const, 0)
const shellsAtom = atom({ plugin: 'vision-view', key: 'shells' } as const, [])
const agentsAtom = atom({ plugin: 'vision-view', key: 'agents' } as const, [])
const spawnedAtAtom = atom({ plugin: 'vision-view', key: 'spawnedAt' } as const, {})
const endedAtAtom = atom({ plugin: 'vision-view', key: 'endedAt' } as const, {})
const prsAtom = atom({ plugin: 'vision-view', key: 'prs' } as const, {})
const askingAtom = atom({ plugin: 'vision-view', key: 'asking' } as const, [])
const isMainIdleAtom = atom({ plugin: 'vision-view', key: 'isMainIdle' } as const, true)
const isShowingFinishedAtom = atom({ plugin: 'vision-view', key: 'isShowingFinished' } as const, false)
const sessionStartedAtAtom = atom({ plugin: 'vision-view', key: 'sessionStartedAt' } as const, 0)
const nowAtom = atom({ plugin: 'vision-view', key: 'now' } as const, 0)

const parsed = new Map<string, { mtimeMs: number; run: Run }>()
const prCheckedAt = new Map<string, number>()
let refreshingSince: number | null = null
let isFetchingPrs = false
let shownRun: Run | null | undefined
let shownStatus = ''
let openedRows = 0

const mainCheckout = async ($: $): Promise<string> => {
  const known = await read($, checkoutAtom)
  if (known !== null) return known

  const git = await $.process
    .run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeoutMs: 5000 })
    .catch(() => undefined)
  if (git?.exitCode !== 0) return $.session.cwd()

  const checkout = git.stdout.trim().replace(/\/\.git\/?$/, '')
  await update($, checkoutAtom, () => checkout)
  return checkout
}

const stateFiles = async ($: $, checkout: string) =>
  (await $.fs.list(`${checkout}/${STATE_DIR}`)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))

const isCurrent = (at: number) => refreshingSince === at

const loadRun = async ($: $, checkout: string, path: string, mtimeMs: number, at: number): Promise<Run | undefined> => {
  const cached = parsed.get(path)
  if (cached?.mtimeMs === mtimeMs) return cached.run

  try {
    const run = parseRun(path, await $.fs.read(`${checkout}/${path}`))
    if (isCurrent(at)) parsed.set(path, { mtimeMs, run })
    return run
  } catch {
    return cached?.run
  }
}

const loadRuns = async ($: $, checkout: string, at: number): Promise<Candidate[]> => {
  const candidates: Candidate[] = []
  for (const { name, mtimeMs } of await stateFiles($, checkout)) {
    const path = `${STATE_DIR}/${name}`
    const run = await loadRun($, checkout, path, mtimeMs, at)
    if (run !== undefined) candidates.push({ path, mtimeMs, run })
  }

  return candidates
}

const refreshRun = async ($: $, at: number) => {
  const candidates = await loadRuns($, await mainCheckout($), at)
  const { chosen, others } = pick(candidates, await read($, pinnedAtom), await read($, sessionStartedAtAtom))
  const run = chosen?.run ?? null
  if (!isCurrent(at)) return

  await update($, otherRunsAtom, () => others)
  if (run === shownRun) return
  shownRun = run
  await update($, runAtom, () => run)
}

const refreshAgents = async ($: $, at: number) => {
  const agents = await $.agent.list()
  if (!isCurrent(at)) return

  const known = await read($, agentsAtom)
  const times = agentTimes(agents, known, await read($, endedAtAtom), at)
  const spawnedAt = await update($, spawnedAtAtom, map => ({ ...map, ...times.started }))
  const endedAt = await update($, endedAtAtom, map => ({
    ...Object.fromEntries(Object.entries(map).filter(([id]) => !times.resumed.includes(id))),
    ...times.ended,
  }))

  await update($, agentsAtom, () => keepJobs(agentJobs(agents, known, spawnedAt, endedAt), JOBS_KEPT))
}

const snapshot = async ($: $): Promise<Snapshot> => {
  const jobs: Job[] = [...(await read($, agentsAtom)), ...(await read($, shellsAtom))].sort(
    (a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0),
  )
  const isAsking = (await read($, askingAtom)).length > 0

  return {
    run: await read($, runAtom),
    otherRuns: await read($, otherRunsAtom),
    jobs,
    prs: await read($, prsAtom),
    attention: isAsking ? 'asking' : (await read($, isMainIdleAtom)) ? 'idle' : 'working',
    isShowingFinished: await read($, isShowingFinishedAtom),
    now: await read($, nowAtom),
  }
}

const refreshStatusLine = async ($: $) => {
  const text = statusText(await snapshot($))
  if ((await read($, modeAtom)) !== 'line' || text === shownStatus) return

  shownStatus = text
  $.ui.status(text)
}

const clearStatusLine = ($: $) => {
  shownStatus = ''
  $.ui.status(undefined)
}

// A refresh overtaken by a newer one, after a stall or by a command, writes nothing.
const refresh = async ($: $, at: number) => {
  refreshingSince = at
  try {
    await refreshRun($, at).catch(() => {
      shownRun = undefined
    })
    await refreshAgents($, at).catch(() => undefined)
  } finally {
    if (isCurrent(at)) refreshingSince = null
  }
}

const refreshNow = async ($: $) => {
  const at = await $.clock.now()
  await update($, nowAtom, () => at)
  await refresh($, at)
  await refreshStatusLine($).catch(() => undefined)
}

// A hook waits on a refresh only briefly, so a read that never answers holds up no command.
const refreshForCommand = ($: $) => Promise.race([refreshNow($).catch(() => undefined), $.clock.sleep(COMMAND_WAIT_MS)])

const fetchPrs = async ($: $, at: number) => {
  isFetchingPrs = true
  try {
    const due = ((await read($, runAtom))?.tasks ?? [])
      .flatMap(task => (task.pr === null ? [] : [task.pr]))
      .filter(url => at - (prCheckedAt.get(url) ?? -Infinity) >= PR_STALE_MS)

    for (const url of due) {
      prCheckedAt.set(url, at)
      const view = await $.process.run(['gh', 'pr', 'view', url, '--json', 'state,isDraft,statusCheckRollup'], { timeoutMs: 15_000 })
      const status = view.exitCode === 0 ? prStatusFrom(view.stdout) : undefined
      if (status !== undefined) await update($, prsAtom, prs => ({ ...prs, [url]: status }))
    }
  } finally {
    isFetchingPrs = false
  }
}

const paneRows = async ($: $) => Math.min(MAX_ROWS, paneLines(await snapshot($)).length + 1)

// An open from a timer is unasked and may wait undrawn on a narrow terminal, so only a pane already on screen is resized.
const fitPane = async ($: $) => {
  const rows = await paneRows($)
  if (rows === openedRows || (await $.ui.panes()).find(one => one.id === PANE)?.isPlaced !== true) return

  openedRows = rows
  await $.ui.open({ id: PANE, title: 'Vision', columns: 64, rows })
}

// The clock moves on every tick whatever else is slow, and a refresh that never settles does not hold back the next.
const advance = async ($: $) => {
  const mode = await read($, modeAtom)
  if (mode === 'closed') return

  const at = await $.clock.now()
  await update($, nowAtom, () => at)
  if (refreshingSince === null || at - refreshingSince > STUCK_MS) void refresh($, at)
  if (mode === 'line') return refreshStatusLine($)

  if (!isFetchingPrs) void fetchPrs($, at).catch(() => undefined)
  await fitPane($)
}

const openPane = async ($: $): Promise<string> => {
  await update($, modeAtom, () => 'pane')
  clearStatusLine($)
  await refreshForCommand($)
  openedRows = await paneRows($)
  const placed = await $.ui.open({ id: PANE, title: 'Vision', focus: true, columns: 64, rows: openedRows })
  if (placed.isPlaced) return 'Vision view opened.'

  await $.ui.close({ id: PANE })
  await update($, modeAtom, () => 'line')
  await refreshStatusLine($)
  return `The vision pane could not be placed (${placed.reason}), so the view shows in the status line instead.`
}

const minimize = async ($: $) => {
  await update($, modeAtom, () => 'line')
  await $.ui.close({ id: PANE })
  await refreshStatusLine($)
}

const closeAll = async ($: $): Promise<string> => {
  await update($, modeAtom, () => 'closed')
  clearStatusLine($)
  await $.ui.close({ id: PANE })
  return 'Vision view closed.'
}

const toggleFinished = async ($: $) => {
  await update($, isShowingFinishedAtom, isShowing => !isShowing)
}

const attach = async ($: $, query: string): Promise<string> => {
  if (query === '') {
    await update($, pinnedAtom, () => null)
    shownRun = undefined
    await refreshForCommand($)
    return 'Vision view follows the run edited last again.'
  }

  const names = (await stateFiles($, await mainCheckout($)).catch(() => []))
    .filter(entry => entry.name.includes(query))
    .map(entry => `${STATE_DIR}/${entry.name}`)
  if (names.length !== 1) {
    return names.length === 0
      ? `No state file in ${STATE_DIR} matches "${query}".`
      : `"${query}" matches ${names.length} state files: ${names.slice(0, 5).join(', ')}`
  }

  await update($, pinnedAtom, () => names[0] ?? null)
  shownRun = undefined
  await refreshForCommand($)
  return `Vision view attached to ${names[0]}.`
}

const USAGE =
  '/vision-view opens the pane · /vision-view min shows one status line · /vision-view close · /vision-view finished shows or hides finished jobs · /vision-view attach <part of a state file name>, or attach alone to follow the latest run · ctrl+x tab hands the pane the keys for h, m and q'

const runCommand = async ($: $, args: string): Promise<string> => {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  if (word === '') {
    if ((await read($, modeAtom)) === 'pane') await $.ui.close({ id: PANE })
    return openPane($)
  }
  if (word === 'close') return closeAll($)
  if (word === 'min') {
    await minimize($)
    return 'Vision view minimized to the status line.'
  }
  if (word === 'finished') {
    await toggleFinished($)
    return (await read($, isShowingFinishedAtom)) ? 'Finished jobs shown.' : 'Finished jobs hidden.'
  }
  if (word === 'attach') return attach($, rest.join(' '))

  return USAGE
}

const TONE: Record<Tone, { color?: string; dimColor?: boolean }> = {
  run: { color: 'green' },
  wait: { color: 'yellow' },
  fail: { color: 'red' },
  done: { color: 'green', dimColor: true },
  dim: { dimColor: true },
  plain: {},
}

const row = (ui: Ui, line: Line) => {
  const { Box, Link, Text } = ui
  const style = TONE[line.tone]
  if (line.href !== undefined) {
    const indent = line.text.match(/^\s*/)?.[0] ?? ''
    return (
      <Box flexDirection="row">
        <Text>{indent}</Text>
        <Link href={line.href} label={line.text.trimStart()} />
      </Box>
    )
  }

  return (
    <Text color={style.color} dimColor={style.dimColor} bold={line.isBold === true} wrap="truncate-end">
      {line.text === '' ? ' ' : line.text}
    </Text>
  )
}

const pane = ($: $, ui: Ui, data: Snapshot) => {
  const { Box, Button, Text } = ui
  const [head, ...body] = paneLines(data)

  return (
    <Box flexDirection="column">
      {head === undefined ? null : row(ui, head)}
      <Box flexDirection="row">
        <Button key="ctl-finished" plain hotkey="h" label={data.isShowingFinished ? 'hide finished' : 'show finished'} onPress={() => toggleFinished($)} />
        <Text>  </Text>
        <Button key="ctl-minimize" plain hotkey="m" label="minimize" onPress={() => minimize($)} />
        <Text>  </Text>
        <Button key="ctl-close" plain hotkey="q" label="close" onPress={() => closeAll($)} />
      </Box>
      {body.map(line => row(ui, line))}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'vision-view',
      description: 'Open the vision pane; min, close, finished and attach are its other actions',
      argumentHint: '[min|close|finished|attach <name>]',
    })
    const at = await $.clock.now()
    // A reload raises session.start again but keeps $.state, so the session's start is set once.
    await update($, sessionStartedAtAtom, since => (since === 0 ? at : since))
    $.clock.every(TICK_MS, () => void advance($).catch(() => undefined))

    return next(e)
  })

  // /clear, /resume and /branch put every $.state value back to its default but leave the pane up.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const isPaneOpen = (await $.ui.panes()).some(one => one.id === PANE)
    await update($, modeAtom, () => (isPaneOpen ? 'pane' : 'closed'))
    if (!isPaneOpen) clearStatusLine($)
    const at = await $.clock.now()
    await update($, sessionStartedAtAtom, () => at)
    shownRun = undefined
    prCheckedAt.clear()
    void refreshNow($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'vision-view' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, modeAtom, () => 'closed')

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    if (e.agentId === undefined) await update($, isMainIdleAtom, () => false)
    if (ASKS.has(String(e.tool))) await update($, askingAtom, ids => [...ids, id])
    try {
      return await next(e)
    } finally {
      await update($, askingAtom, ids => ids.filter(one => one !== id))
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const taskId = backgroundTaskId(ran.result)
    if (taskId !== undefined && e.agentId === undefined) {
      const at = await $.clock.now()
      const shell = {
        id: taskId,
        label: shellLabel(e.description, e.command),
        status: 'running' as const,
        startedAt: at,
        endedAt: null,
      }
      await update($, shellsAtom, shells => keepJobs([...shells.filter(one => one.id !== taskId), shell], JOBS_KEPT))
    }

    return ran
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    if (VISION_SKILL.test(e.skill) && (await read($, modeAtom)) === 'closed') {
      await update($, modeAtom, () => 'line')
      void refreshNow($).catch(() => undefined)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const notices = e.origin.kind === 'task-notification' ? noticesOf(e.text) : []
    if (notices.length > 0) {
      const at = await $.clock.now()
      await update($, shellsAtom, shells => settle(shells, notices, at))
    }

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    const inFlight = e.background_tasks
    if (Array.isArray(inFlight)) {
      const at = await $.clock.now()
      await update($, shellsAtom, shells => reconcile(shells, new Set(inFlight.map(task => task.id)), at))
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, isMainIdleAtom, () => false)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isMainIdleAtom, () => true)
      await update($, askingAtom, () => [])
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const { agentId } = spawned
    if (agentId !== undefined) {
      const at = await $.clock.now()
      await update($, spawnedAtAtom, map => ({ ...map, [agentId]: at }))
    }

    return spawned
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => pane($, $.ui.resolve(e), await snapshot($)))
}
