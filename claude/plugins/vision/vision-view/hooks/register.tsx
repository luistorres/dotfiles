import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Job, Run } from '../types'
import { agentJob, backgroundTaskId, isLive, jobStatus, noticeOf, reconcile, settle, shellLabel } from './jobs'
import { prStatusFrom } from './pr'
import { parseRun, pick, type Candidate } from './run'
import { paneLines, statusText, type Line, type Snapshot, type Tone } from './view'

type $ = EngineInterface
type Ui = ReturnType<$['ui']['resolve']>

const PANE = 'vision-view'
const STATE_DIR = 'docs/vision'
const TICK_MS = 2000
const FOCUS_RETRY_MS = 250
const PR_STALE_MS = 60_000
const PR_PER_TICK = 2
const MAX_ROWS = 40
const SHELLS_KEPT = 40
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
let isTicking = false
let shownRun = ''
let shownStatus = ''
let openedRows = 0

const mainCheckout = async ($: $): Promise<string> => {
  const known = await read($, checkoutAtom)
  if (known !== null) return known

  const git = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeoutMs: 5000 })
  const checkout = git.exitCode === 0 ? git.stdout.trim().replace(/\/\.git\/?$/, '') : await $.session.cwd()
  await update($, checkoutAtom, () => checkout)
  return checkout
}

const loadRuns = async ($: $, checkout: string): Promise<Candidate[]> => {
  const entries = await $.fs.list(`${checkout}/${STATE_DIR}`)
  const candidates: Candidate[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue

    const path = `${STATE_DIR}/${entry.name}`
    try {
      const { mtimeMs } = await $.fs.stat(`${checkout}/${path}`)
      const cached = parsed.get(path)
      const run = cached?.mtimeMs === mtimeMs ? cached.run : parseRun(path, await $.fs.read(`${checkout}/${path}`))
      parsed.set(path, { mtimeMs, run })
      candidates.push({ path, mtimeMs, run })
    } catch {
      parsed.delete(path)
    }
  }

  return candidates
}

const refreshRun = async ($: $) => {
  const checkout = await mainCheckout($)
  const candidates = await loadRuns($, checkout)
  const { chosen, others } = pick(candidates, await read($, pinnedAtom), await read($, sessionStartedAtAtom))
  const key = chosen === undefined ? '' : `${chosen.path}@${chosen.mtimeMs}`

  await update($, otherRunsAtom, () => others)
  if (key === shownRun) return
  shownRun = key
  await update($, runAtom, () => chosen?.run ?? null)
}

const refreshAgents = async ($: $, at: number) => {
  const agents = await $.agent.list()
  const spawnedAt = await read($, spawnedAtAtom)
  const known = await read($, endedAtAtom)
  const ended = agents.filter(agent => !isLive({ status: jobStatus(agent.status) }) && known[agent.id] === undefined)
  const endedAt = ended.length === 0 ? known : { ...known, ...Object.fromEntries(ended.map(agent => [agent.id, at])) }

  if (ended.length > 0) await update($, endedAtAtom, () => endedAt)
  await update($, agentsAtom, () => agents.map(agent => agentJob(agent, spawnedAt[agent.id], endedAt[agent.id])))
}

const refreshPrs = async ($: $, at: number) => {
  const run = await read($, runAtom)
  const due = (run?.tasks ?? [])
    .flatMap(task => (task.pr === null ? [] : [task.pr]))
    .filter(url => at - (prCheckedAt.get(url) ?? -Infinity) >= PR_STALE_MS)
    .slice(0, PR_PER_TICK)

  for (const url of due) {
    prCheckedAt.set(url, at)
    const view = await $.process.run(['gh', 'pr', 'view', url, '--json', 'state,isDraft,statusCheckRollup'], { timeoutMs: 15_000 })
    const status = view.exitCode === 0 ? prStatusFrom(view.stdout, at) : undefined
    if (status !== undefined) await update($, prsAtom, prs => ({ ...prs, [url]: status }))
  }
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
  if (text === shownStatus) return

  shownStatus = text
  $.ui.status(text)
}

// Each part refreshes on its own, so a failing git, gh or file read leaves the rest of the pane, and its clock, current.
const tick = async ($: $) => {
  if (isTicking) return
  isTicking = true
  try {
    const mode = await read($, modeAtom)
    if (mode === 'closed') return

    const at = await $.clock.now()
    await update($, nowAtom, () => at)
    await refreshRun($).catch(() => {
      shownRun = ''
    })
    await refreshAgents($, at).catch(() => undefined)
    if (mode === 'pane') await refreshPrs($, at).catch(() => undefined)
    if (mode === 'pane') await fitPane($).catch(() => undefined)
    if (mode === 'line') await refreshStatusLine($).catch(() => undefined)
  } finally {
    isTicking = false
  }
}

const isPaneFocused = async ($: $) => (await $.ui.panes()).find(one => one.id === PANE)?.isFocused === true

// Seated inline above the prompt a pane gets a third of the screen unless it asks for its height, which would hide the controls.
const paneRows = async ($: $) => Math.min(MAX_ROWS, paneLines(await snapshot($)).length + 2)

const paneArgs = async ($: $) => {
  openedRows = await paneRows($)

  return { id: PANE, title: 'Vision', focus: true, columns: 64, rows: openedRows } as const
}

const fitPane = async ($: $) => {
  const rows = await paneRows($)
  if (rows === openedRows) return

  openedRows = rows
  await $.ui.open({ id: PANE, title: 'Vision', columns: 64, rows })
}

// The focus request is refused while the composer still holds the command that opened the pane, so ask again once it has cleared.
const claimFocus = async ($: $) => {
  if (await isPaneFocused($)) return

  await $.ui.close({ id: PANE })
  await $.ui.open(await paneArgs($))
}

const openPane = async ($: $): Promise<string> => {
  await update($, modeAtom, () => 'pane')
  shownStatus = ''
  $.ui.status(undefined)
  await tick($)
  const placed = await $.ui.open(await paneArgs($))
  if (!placed.isPlaced) {
    await update($, modeAtom, () => 'line')
    await tick($)
    return 'The vision view could not open a pane here, so it shows in the status line instead.'
  }
  $.clock.after(FOCUS_RETRY_MS, () => void claimFocus($))
  return 'Vision view opened.'
}

const minimize = async ($: $) => {
  await update($, modeAtom, () => 'line')
  await $.ui.close({ id: PANE })
  await tick($)
}

const closeAll = async ($: $): Promise<string> => {
  await update($, modeAtom, () => 'closed')
  shownStatus = ''
  $.ui.status(undefined)
  await $.ui.close({ id: PANE })
  return 'Vision view closed.'
}

const toggleFinished = async ($: $) => {
  await update($, isShowingFinishedAtom, isShowing => !isShowing)
}

const attach = async ($: $, query: string): Promise<string> => {
  if (query === '') {
    await update($, pinnedAtom, () => null)
    shownRun = ''
    await tick($)
    return 'Vision view follows the run edited last again.'
  }

  const names = (await $.fs.list(`${await mainCheckout($)}/${STATE_DIR}`))
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.md') && entry.name.includes(query))
    .map(entry => `${STATE_DIR}/${entry.name}`)
  if (names.length !== 1) {
    return names.length === 0
      ? `No state file in ${STATE_DIR} matches "${query}".`
      : `"${query}" matches ${names.length} state files: ${names.slice(0, 5).join(', ')}`
  }

  await update($, pinnedAtom, () => names[0] ?? null)
  shownRun = ''
  await tick($)
  return `Vision view attached to ${names[0]}.`
}

const USAGE =
  '/vision-view opens the pane · /vision-view min shows one status line · /vision-view close · /vision-view finished shows or hides finished jobs · /vision-view attach <part of a state file name>, or attach alone to follow the latest run'

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

  return (
    <Box flexDirection="column">
      {paneLines(data).map(line => row(ui, line))}
      <Text> </Text>
      <Box flexDirection="row">
        <Button key="ctl-finished" plain hotkey="h" label={data.isShowingFinished ? 'hide finished' : 'show finished'} onPress={() => toggleFinished($)} />
        <Text>  </Text>
        <Button key="ctl-minimize" plain hotkey="m" label="minimize" onPress={() => minimize($)} />
        <Text>  </Text>
        <Button key="ctl-close" plain hotkey="q" label="close" onPress={() => closeAll($)} />
      </Box>
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
    await update($, sessionStartedAtAtom, () => at)
    $.clock.every(TICK_MS, () => void tick($))

    return next(e)
  })

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const at = await $.clock.now()
    await update($, sessionStartedAtAtom, () => at)
    shownRun = ''
    shownStatus = ''

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

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (verdict.decision === 'ask' && id !== undefined) await update($, askingAtom, ids => [...ids, id])

    return verdict
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const taskId = backgroundTaskId(ran.result)
    if (taskId !== undefined) {
      const at = await $.clock.now()
      const shell = {
        id: taskId,
        toolUseId: e.tool_use_id,
        label: shellLabel(e.description, e.command),
        status: 'running' as const,
        startedAt: at,
        endedAt: null,
      }
      await update($, shellsAtom, shells => [...shells.filter(one => one.id !== taskId), shell].slice(-SHELLS_KEPT))
    }

    return ran
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    if (VISION_SKILL.test(e.skill) && (await read($, modeAtom)) === 'closed') {
      await update($, modeAtom, () => 'line')
      await tick($)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const notice = e.origin.kind === 'task-notification' ? noticeOf(e.text) : undefined
    if (notice !== undefined) {
      const at = await $.clock.now()
      await update($, shellsAtom, shells => settle(shells, notice, at))
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
    await update($, isMainIdleAtom, () => false)

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
