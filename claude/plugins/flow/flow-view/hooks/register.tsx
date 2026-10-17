import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, AgentNode, LastSkill, Reviewer, Workflow } from '../types'
import { failureLine, livenessPattern, logPath, logToken, modelOf, pullRequestUrl, reviewCycle, reviewerKind, streamsOutput } from './reviewers'
import { anchorPath, elapsed, firstStepId, flatten, OTHER, shipNodes, type Row, stepAnchor, stepNodes, type Tone, type TreeNode, withoutFinished } from './tree'
import { prStatusFrom } from './pr'
import { currentStep, kindOf, parseWorkflow, stateFileOf } from './workflow'

type $ = EngineInterface
type Ui = ReturnType<$['ui']['resolve']>

const PANE = 'flow-view'
const AGENT_PANE = 'flow-view-agent'

const modeAtom = atom({ plugin: 'flow-view', key: 'mode' } as const, 'closed')
const workflowAtom = atom({ plugin: 'flow-view', key: 'workflow' } as const, null)
const agentsAtom = atom({ plugin: 'flow-view', key: 'agents' } as const, [])
const spawnedAtAtom = atom({ plugin: 'flow-view', key: 'spawnedAt' } as const, {})
const stepOfAtom = atom({ plugin: 'flow-view', key: 'stepOf' } as const, {})
const ownedPathsAtom = atom({ plugin: 'flow-view', key: 'ownedPaths' } as const, [])
const inFlightAtom = atom({ plugin: 'flow-view', key: 'inFlight' } as const, {})
const askingAtom = atom({ plugin: 'flow-view', key: 'asking' } as const, [])
const isMainIdleAtom = atom({ plugin: 'flow-view', key: 'isMainIdle' } as const, false)
const mainActivityAtom = atom({ plugin: 'flow-view', key: 'mainActivity' } as const, null)
const prStatusAtom = atom({ plugin: 'flow-view', key: 'prStatus' } as const, null)
const reviewersAtom = atom({ plugin: 'flow-view', key: 'reviewers' } as const, [])
const lastSkillAtom = atom({ plugin: 'flow-view', key: 'lastSkill' } as const, null)
const reviewLoopAtAtom = atom({ plugin: 'flow-view', key: 'reviewLoopAt' } as const, null)
const wakeAtAtom = atom({ plugin: 'flow-view', key: 'wakeAt' } as const, null)
const prUrlAtom = atom({ plugin: 'flow-view', key: 'prUrl' } as const, null)
const expandedAtom = atom({ plugin: 'flow-view', key: 'expanded' } as const, [])
const detailsAtom = atom({ plugin: 'flow-view', key: 'details' } as const, {})
const hideFinishedAtom = atom({ plugin: 'flow-view', key: 'hideFinished' } as const, false)
const openedAtom = atom({ plugin: 'flow-view', key: 'opened' } as const, null)
const nowAtom = atom({ plugin: 'flow-view', key: 'now' } as const, 0)

const INLINE_LINES = 8

const isAgentId = (id: string) => id !== OTHER && !id.includes('::')
const FULL_LINES = 300

const mainCheckout = async ($: $): Promise<string> => {
  const git = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'])

  return git.exitCode === 0 ? git.stdout.trim().replace(/\/\.git\/?$/, '') : $.session.cwd()
}

const readWorkflow = async ($: $, checkout: string, relPath: string): Promise<Workflow | null> => {
  try {
    const path = `${checkout}/${relPath}`
    const updatedAt = (await $.fs.stat(path)).mtimeMs

    return { ...parseWorkflow(kindOf(relPath), relPath, await $.fs.read(path)), absPath: path, updatedAt }
  } catch {
    return null
  }
}

// A run belongs to the session that writes its state file; lean-flow and flow both edit it at every step, a resumed run included.
const findWorkflow = async ($: $): Promise<Workflow | null> => {
  const owned = await read($, ownedPathsAtom)
  if (owned.length === 0) return null

  const checkout = await mainCheckout($)
  const runs: Workflow[] = []
  for (const relPath of [...owned].reverse()) {
    const run = await readWorkflow($, checkout, relPath)
    if (run !== null) runs.push(run)
  }

  return runs.find(run => run.isActive) ?? runs[0] ?? null
}

const WRITERS = new Set(['Write', 'Edit', 'MultiEdit'])

const claimStateFile = async ($: $, filePath: unknown) => {
  const relPath = typeof filePath === 'string' ? stateFileOf(filePath) : undefined
  if (relPath === undefined) return

  await update($, ownedPathsAtom, paths => [...paths.filter(one => one !== relPath), relPath])
}

// Ownership lives in session state, which a restart clears; the conversation it came from survives, so the state files this session wrote are recovered from its own tool calls.
const claimFromHistory = async ($: $) => {
  if ((await read($, ownedPathsAtom)).length > 0) return

  for (const message of await $.session.messages()) {
    for (const use of message.toolUses) {
      if (WRITERS.has(use.tool)) await claimStateFile($, use.input.file_path)
    }
  }
}

const stateFileNames = async ($: $, checkout: string): Promise<string[]> => {
  const listed = await Promise.all(
    ['lean', 'plans'].map(async dir => {
      try {
        return (await $.fs.list(`${checkout}/docs/flow/${dir}`)).map(entry => `docs/flow/${dir}/${entry.name}`)
      } catch {
        return []
      }
    }),
  )

  return listed.flat().filter(path => stateFileOf(path) !== undefined)
}

const attach = async ($: $, query: string): Promise<string> => {
  const checkout = await mainCheckout($)
  const matches = (await stateFileNames($, checkout)).filter(path => path.includes(query))
  if (matches.length !== 1) {
    return matches.length === 0
      ? `No flow or lean-flow state file matches "${query}".`
      : `"${query}" matches ${matches.length} state files: ${matches.slice(0, 5).join(', ')}`
  }

  const [path] = matches
  await claimStateFile($, `${checkout}/${path}`)
  await tick($)
  return `Flow view attached to ${path}.`
}

const refreshAgents = async ($: $) => {
  const list = await $.agent.list()
  const nodes: AgentNode[] = list.map(({ id, description, type, status, parentId }) => ({
    id,
    description,
    type,
    status,
    parentId,
  }))

  await update($, agentsAtom, () => nodes)
}

const GROWTH_GRACE_MS = 20_000

const isProcessAlive = async ($: $, reviewer: Reviewer, at: number) =>
  at - reviewer.grewAt < GROWTH_GRACE_MS ||
  (await $.process.run(['pgrep', '-f', '--', livenessPattern(reviewer)])).exitCode === 0

const logFailure = async ($: $, reviewer: Reviewer): Promise<string | undefined> => {
  if (reviewer.logPath === undefined) return undefined

  try {
    return failureLine((await $.fs.read(reviewer.logPath)).slice(-4000))
  } catch {
    return undefined
  }
}

const logSize = async ($: $, reviewer: Reviewer) => {
  if (reviewer.logPath === undefined) return reviewer.logBytes

  try {
    return (await $.fs.stat(reviewer.logPath)).size
  } catch {
    return reviewer.logBytes
  }
}

const checkReviewer = async ($: $, reviewer: Reviewer, at: number): Promise<Reviewer> => {
  if (reviewer.endedAt !== undefined) return reviewer

  const size = await logSize($, reviewer)
  const grown = size > reviewer.logBytes ? { logBytes: size, grewAt: at } : {}

  const checked = { ...reviewer, ...grown }
  if (await isProcessAlive($, checked, at)) return checked

  const failure = await logFailure($, checked)
  $.ui.toast(
    failure === undefined
      ? `${reviewer.label} finished after ${elapsed(at - reviewer.startedAt)}`
      : `${reviewer.label} failed: ${failure}`,
  )

  return { ...checked, endedAt: at, hasFailed: failure !== undefined }
}

const refreshReviewers = async ($: $, at: number) => {
  const checked: Reviewer[] = []
  for (const reviewer of await read($, reviewersAtom)) checked.push(await checkReviewer($, reviewer, at))

  await update($, reviewersAtom, () => checked)
}

const firstLine = (text: string) => text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''

const inputGist = (input: Record<string, unknown>): string => {
  const keys = ['command', 'file_path', 'pattern', 'description', 'skill', 'url', 'prompt']
  const value = keys.map(key => input[key]).find(one => typeof one === 'string')

  return typeof value === 'string' ? firstLine(value) : ''
}

const agentLines = async ($: $, agentId: string, limit: number): Promise<string[]> => {
  const messages = await $.session.messages({ agentId })
  if (!Array.isArray(messages)) return [messages.deny]

  return messages.flatMap(message => [
    ...(firstLine(message.text) === '' ? [] : [`${message.role === 'user' ? '›' : '•'} ${firstLine(message.text)}`]),
    ...message.toolUses.map(use => `  ${use.tool} ${inputGist(use.input)}`),
  ]).slice(-limit)
}

const reviewerLines = async ($: $, reviewer: Reviewer, limit: number): Promise<string[]> => {
  if (reviewer.logPath === undefined) return ['The command writes no log file, so there is no output to show.']

  try {
    return (await $.fs.read(reviewer.logPath)).trimEnd().split('\n').slice(-limit)
  } catch {
    return [`${reviewer.logPath} is not readable yet.`]
  }
}

const detailLines = async ($: $, id: string, limit: number): Promise<string[]> => {
  const reviewer = (await read($, reviewersAtom)).find(one => one.id === id)

  return reviewer === undefined ? agentLines($, id, limit) : reviewerLines($, reviewer, limit)
}

const refreshDetails = async ($: $) => {
  const open = await read($, openedAtom)
  const ids = await read($, expandedAtom)
  const next: Record<string, string[]> = {}
  for (const id of ids.filter(isAgentId)) next[id] = await detailLines($, id, INLINE_LINES)
  if (open !== null) next[`full:${open}`] = await detailLines($, open, FULL_LINES)

  await update($, detailsAtom, () => next)
}

const summary = (flow: Workflow | null, cycle: number, running: number): string => {
  const step = flow === null ? undefined : currentStep(flow.steps)
  const sub = flow === null ? undefined : currentStep(flow.substeps)
  const parts = [
    flow === null ? 'flow starting' : `${flow.kind === 'flow' ? 'flow' : 'lean-flow'} ▶ ${step?.label ?? 'done'}`,
    sub === undefined ? '' : `› ${sub.label}`,
    cycle > 0 ? `review cycle ${cycle}` : '',
    running > 0 ? `${running} running` : '',
  ]

  return parts.filter(part => part !== '').join(' · ')
}

const refreshStatusLine = async ($: $) => {
  const loopAt = await read($, reviewLoopAtAtom)
  const cycle = loopAt === null ? 0 : reviewCycle(await read($, reviewersAtom), loopAt)
  const liveAgents = (await read($, agentsAtom)).filter(agent => agent.status === 'running').length
  const liveReviewers = (await read($, reviewersAtom)).filter(one => one.endedAt === undefined).length

  $.ui.status(summary(await read($, workflowAtom), cycle, liveAgents + liveReviewers))
}

const FOLLOW_WINDOW_MS = 120_000

// Lean-flow ticks a step after finishing it, so work launched in the same breath starts under the old step and follows the current one for a short while; an agent resumed later stays where it did its work.
const followRunningWork = async ($: $, flow: Workflow | null, at: number) => {
  const anchor = stepAnchor(flow)
  if (anchor === undefined || flow?.isActive !== true) return

  const spawnedAt = await read($, spawnedAtAtom)
  const isFresh = (startedAt: number | undefined) => startedAt !== undefined && at - startedAt < FOLLOW_WINDOW_MS
  const fresh = [
    ...(await read($, agentsAtom)).filter(agent => agent.status === 'running' && isFresh(spawnedAt[agent.id])).map(agent => agent.id),
    ...(await read($, reviewersAtom)).filter(one => one.endedAt === undefined && isFresh(one.startedAt)).map(one => one.id),
  ]
  await update($, stepOfAtom, map => ({ ...map, ...Object.fromEntries(fresh.map(id => [id, anchor])) }))
}

const PR_REFRESH_MS = 60_000

const refreshPullRequest = async ($: $, flow: Workflow | null, at: number) => {
  const url = flow?.prUrl ?? null
  if (url === null) return

  const known = await read($, prStatusAtom)
  if (known !== null && known.url === url && at - known.fetchedAt < PR_REFRESH_MS) return

  const view = await $.process.run(['gh', 'pr', 'view', url, '--json', 'number,url,state,isDraft,reviewDecision,statusCheckRollup'])
  const status = view.exitCode === 0 ? prStatusFrom(view.stdout, at) : undefined
  if (status !== undefined) await update($, prStatusAtom, () => status)
}

const tick = async ($: $) => {
  const current = await read($, modeAtom)
  if (current === 'closed') return

  const at = await $.clock.now()
  const found = await findWorkflow($)
  await update($, workflowAtom, () => found)
  await refreshAgents($)
  await refreshReviewers($, at)
  await followRunningWork($, found, at)
  await refreshPullRequest($, found, at)
  if (current === 'pane') await refreshDetails($)
  if (current === 'line') await refreshStatusLine($)
  await update($, nowAtom, () => at)
}

const PANE_ARGS = { id: PANE, title: 'Flow', focus: true, columns: 64 } as const
const FOCUS_RETRY_MS = 250

// The focus request is refused while the composer still holds the command that opened the pane, so ask again once it has cleared.
const isPaneFocused = async ($: $) => (await $.ui.panes()).find(one => one.id === PANE)?.isFocused === true

const claimFocus = async ($: $) => {
  if (await isPaneFocused($)) return

  await $.ui.close({ id: PANE })
  await $.ui.open(PANE_ARGS)
  if (!(await isPaneFocused($))) $.ui.toast('Flow pane could not take the keyboard; run /flow-view again')
}

const showPane = async ($: $): Promise<string> => {
  await update($, modeAtom, () => 'pane')
  $.ui.status(undefined)
  await tick($)
  const placed = await $.ui.open(PANE_ARGS)
  if (!placed.isPlaced) {
    await update($, modeAtom, () => 'line')
    await tick($)
    return `Flow view could not open a pane (${placed.reason}), so it shows in the status line instead.`
  }
  $.clock.after(FOCUS_RETRY_MS, () => void claimFocus($))
  return 'Flow view opened.'
}

const minimize = async ($: $) => {
  await update($, modeAtom, () => 'line')
  await $.ui.close({ id: PANE })
  await tick($)
}

// Starting a flow is the moment its one-line summary earns its place; the pane itself still waits for /flow-view.
const showStatusLine = async ($: $) => {
  if ((await read($, modeAtom)) !== 'closed') return

  await update($, modeAtom, () => 'line')
  await tick($)
}

const closeAll = async ($: $): Promise<string> => {
  if ((await read($, modeAtom)) === 'closed') return 'Flow view is already closed.'

  await update($, modeAtom, () => 'closed')
  $.ui.status(undefined)
  await $.ui.close({ id: PANE })
  return 'Flow view closed.'
}

const toggleExpanded = async ($: $, id: string) => {
  await update($, expandedAtom, ids => (ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id]))
  await tick($)
}

const toggleFinished = ($: $) => update($, hideFinishedAtom, isHidden => !isHidden)

const openAgent = async ($: $, id: string, title: string) => {
  await update($, openedAtom, () => id)
  await tick($)
  await $.ui.open({ id: AGENT_PANE, title: title.slice(0, 48), focus: true, closeOnEscape: true })
}

type PaneData = {
  at: number
  flow: Workflow | null
  cycle: number
  skill: LastSkill | null
  wake: number | null
  pr: string | null
  rows: Row[]
  details: Readonly<Record<string, string[]>>
  isHidingFinished: boolean
  isWaiting: boolean
  activity: Activity | null
}

const ACTIVITY_GIST = 48

const stateLine = (ui: Ui, data: PaneData) => {
  const { Text } = ui
  if (data.isWaiting) return <Text color="yellow">● waiting for you</Text>
  if (data.activity === null) return null

  const { tool, gist, at } = data.activity
  return (
    <Text color="green" wrap="truncate-end">
      ● working · {tool} {gist.slice(0, ACTIVITY_GIST)} · {elapsed(data.at - at)}
    </Text>
  )
}

const header = (ui: Ui, data: PaneData) => {
  const { flow } = data
  const { Box, Text } = ui
  if (flow === null) {
    return (
      <Box flexDirection="column">
        {stateLine(ui, data)}
        <Text dimColor>No flow or lean-flow run in this session yet.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {stateLine(ui, data)}
      <Text bold wrap="truncate-end">
        {flow.kind === 'flow' ? 'flow' : 'lean-flow'} · {flow.title}
      </Text>
      <Text dimColor>
        {[flow.headline, flow.isActive ? '' : 'finished'].filter(part => part !== '').join(' · ')}
      </Text>
      {flow.kind === 'flow' &&
        [`Tasks: ${flow.path}`, ...flow.files].map(line => (
          <Text dimColor wrap="truncate-end">
            {line}
          </Text>
        ))}
    </Box>
  )
}

const activitySection = (ui: Ui, data: PaneData) => {
  const { Box, Text } = ui
  const lines = [
    data.cycle > 0 ? `Review cycle ${data.cycle}` : '',
    data.pr === null ? '' : `PR ${data.pr}`,
    data.skill === null ? '' : `Last skill ${data.skill.name} (${elapsed(data.at - data.skill.at)} ago)`,
    data.wake !== null && data.wake > data.at ? `Next wake-up in ${elapsed(data.wake - data.at)}` : '',
  ].filter(line => line !== '')

  return (
    <Box flexDirection="column">
      {lines.map(line => (
        <Text dimColor wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  )
}

const detailBlock = ($: $, ui: Ui, row: Row, lines: readonly string[]) => {
  const { Box, Button, Text } = ui

  return (
    <Box flexDirection="column">
      {lines.length === 0 && <Text dimColor>{row.indent}  Loading…</Text>}
      {lines.map(line => (
        <Text dimColor wrap="truncate-end">
          {row.indent}
          {'  '}
          {line}
        </Text>
      ))}
      <Box flexDirection="row">
        <Text>
          {row.indent}
          {'  '}
        </Text>
        <Button key={`open-${row.id}`} plain label="open full view" onPress={() => openAgent($, row.id, row.label)} />
      </Box>
    </Box>
  )
}

const TONE_COLOR: Record<Tone, string | undefined> = { run: 'green', wait: 'yellow', fail: 'red', none: undefined }

const caret = (row: Row) => (row.hasChildren || row.kind === 'agent' ? (row.isOpen ? '▾' : '▸') : ' ')

const noteRow = (ui: Ui, row: Row) => {
  const { Text } = ui

  return (
    <Text dimColor wrap="truncate-end">
      {row.prefix}
      {'  '}
      {row.label}
    </Text>
  )
}

const linkRow = (ui: Ui, row: Row) => {
  const { Box, Markdown, Text } = ui

  return (
    <Box flexDirection="row">
      <Text dimColor>
        {row.prefix}
        {'  '}
      </Text>
      <Markdown text={row.label} />
    </Box>
  )
}

const treeRow = ($: $, ui: Ui, data: PaneData, row: Row) => {
  const { Box, Button, Text } = ui
  if (row.kind === 'note') return noteRow(ui, row)
  if (row.kind === 'link') return linkRow(ui, row)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text dimColor>{row.prefix}</Text>
        <Text color={TONE_COLOR[row.tone]}>{row.tone === 'none' ? ' ' : '●'} </Text>
        <Button key={`row-${row.id}`} plain label={`${caret(row)} ${row.label}`} onPress={() => toggleExpanded($, row.id)} />
        <Text color={TONE_COLOR[row.tone]} dimColor={row.tone === 'none'} wrap="truncate-end">
          {row.meta === '' ? '' : ` ${row.meta}`}
        </Text>
      </Box>
      {row.kind === 'agent' && row.isOpen && detailBlock($, ui, row, data.details[row.id] ?? [])}
    </Box>
  )
}

const CONTROL = 'ctl-'

const collapseAll = ($: $, rows: readonly Row[]) => {
  const open = new Set(rows.filter(row => row.isOpen).map(row => row.id))

  return update($, expandedAtom, ids => [
    ...ids.filter(id => !open.has(id)),
    ...[...open].filter(id => !ids.includes(id)),
  ])
}

const controls = ($: $, ui: Ui, data: PaneData) => {
  const { Box, Button, Text } = ui

  return (
    <Box flexDirection="row">
      <Button key={`${CONTROL}finished`} plain hotkey="h" label={data.isHidingFinished ? 'show finished' : 'hide finished'} onPress={() => toggleFinished($)} />
      <Text>  </Text>
      <Button key={`${CONTROL}collapse`} plain hotkey="c" label="collapse all" onPress={() => collapseAll($, data.rows)} />
      <Text>  </Text>
      <Button key={`${CONTROL}minimize`} plain hotkey="m" label="minimize" onPress={() => minimize($)} />
      <Text>  </Text>
      <Button key={`${CONTROL}close`} plain hotkey="q" label="close" onPress={() => closeAll($)} />
    </Box>
  )
}

const flowPane = ($: $, ui: Ui, data: PaneData) => {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column">
      {header(ui, data)}
      {activitySection(ui, data)}
      <Text> </Text>
      {data.rows.length === 0 && <Text dimColor>No steps or agents yet.</Text>}
      {data.rows.map(row => treeRow($, ui, data, row))}
      <Text> </Text>
      {controls($, ui, data)}
    </Box>
  )
}

const agentPane = (ui: Ui, lines: readonly string[]) => {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column">
      {lines.length === 0 && <Text dimColor>Loading…</Text>}
      {lines.map(line => (
        <Text wrap="wrap">{line}</Text>
      ))}
      <Text dimColor>Esc closes this view.</Text>
    </Box>
  )
}

const TICK_MS = 3000
const QUIET_MS = 90_000
const REVIEW_SKILL = /agents-review$/
const FLOW_SKILL = /(?:^|:)(?:flow|lean-flow)$/

const FAILED = new Set(['failed', 'killed'])

const agentTone = (agent: AgentNode, waiting: ReadonlySet<string>): Tone => {
  if (FAILED.has(agent.status)) return 'fail'
  if (waiting.has(agent.id)) return 'wait'

  return agent.status === 'running' ? 'run' : 'none'
}

const agentNode = (
  agent: AgentNode,
  step: string | undefined,
  startedAt: number | undefined,
  at: number,
  waiting: ReadonlySet<string>,
): TreeNode => ({
  id: agent.id,
  parentId: agent.parentId ?? step ?? OTHER,
  kind: 'agent',
  tone: agentTone(agent, waiting),
  label: `${agent.type} · ${agent.description}`,
  meta: startedAt === undefined ? agent.status : `${agent.status} ${elapsed(at - startedAt)}`,
  isLive: agent.status === 'running',
})

const reviewerMeta = (reviewer: Reviewer, at: number): string => {
  if (reviewer.endedAt !== undefined) return `done in ${elapsed(reviewer.endedAt - reviewer.startedAt)}`

  const quiet = at - reviewer.grewAt
  const log = `${Math.round(reviewer.logBytes / 1024)} KB`

  const isQuiet = streamsOutput(reviewer.kind) && quiet > QUIET_MS
  return `running ${elapsed(at - reviewer.startedAt)} · ${log}${isQuiet ? ` · quiet ${elapsed(quiet)}` : ''}`
}

const reviewerTone = (reviewer: Reviewer, at: number): Tone => {
  if (reviewer.hasFailed === true) return 'fail'
  if (reviewer.endedAt !== undefined) return 'none'

  return streamsOutput(reviewer.kind) && at - reviewer.grewAt > QUIET_MS ? 'wait' : 'run'
}

const reviewerNode = (reviewer: Reviewer, step: string | undefined, at: number): TreeNode => ({
  id: reviewer.id,
  parentId: reviewer.parentId ?? step ?? OTHER,
  kind: 'agent',
  tone: reviewerTone(reviewer, at),
  label: reviewer.label,
  meta: reviewerMeta(reviewer, at),
  isLive: reviewer.endedAt === undefined,
})

const MAIN = 'main'

// A main session that ended its turn mid-run with nothing running in the background is waiting on the person, as surely as an open question is.
const waitingLoops = async ($: $): Promise<Set<string>> => {
  const inFlight = await read($, inFlightAtom)
  const asking = (await read($, askingAtom)).map(id => inFlight[id] ?? MAIN)
  const isWorkRunning =
    (await read($, agentsAtom)).some(agent => agent.status === 'running') ||
    (await read($, reviewersAtom)).some(one => one.endedAt === undefined)
  const isIdleMidRun =
    (await read($, isMainIdleAtom)) && !isWorkRunning && (await read($, workflowAtom))?.isActive === true

  return new Set([...asking, ...(isIdleMidRun ? [MAIN] : [])])
}

const otherGroup = (nodes: readonly TreeNode[]): TreeNode[] =>
  nodes.some(node => node.parentId === OTHER)
    ? [{ id: OTHER, kind: 'group', label: 'Outside a step', meta: '', isLive: false, tone: 'none' }]
    : []

const treeNodes = async ($: $, flow: Workflow | null, at: number): Promise<TreeNode[]> => {
  const started = await read($, spawnedAtAtom)
  const stepOf = await read($, stepOfAtom)
  const waiting = await waitingLoops($)
  const steps = stepNodes(flow, Object.values(stepOf)).map(node =>
    node.isLive && waiting.has(MAIN) ? { ...node, tone: 'wait' as const } : node,
  )
  const work = [
    ...(await read($, agentsAtom)).map(agent => agentNode(agent, stepOf[agent.id], started[agent.id], at, waiting)),
    ...(await read($, reviewersAtom)).map(reviewer => reviewerNode(reviewer, stepOf[reviewer.id], at)),
  ]
  const ownWork = work.filter(node => {
    const anchor = stepOf[node.id]
    return anchor === undefined || flow === null || anchorPath(anchor) === flow.path || node.isLive
  })
  // Work that started before the run's state file existed was framing it.
  const home = flow === null ? undefined : firstStepId(flow)
  const placed = home === undefined ? ownWork : ownWork.map(node => (node.parentId === OTHER ? { ...node, parentId: home } : node))
  const nodes = [...steps, ...shipNodes(flow, await read($, prStatusAtom)), ...otherGroup(placed), ...placed]

  return (await read($, hideFinishedAtom)) ? withoutFinished(nodes) : nodes
}

const paneData = async ($: $): Promise<PaneData> => {
  const at = await read($, nowAtom)
  const flow = await read($, workflowAtom)
  const loopAt = await read($, reviewLoopAtAtom)

  return {
    at,
    flow,
    cycle: loopAt === null ? 0 : reviewCycle(await read($, reviewersAtom), loopAt),
    skill: await read($, lastSkillAtom),
    wake: await read($, wakeAtAtom),
    pr: await read($, prUrlAtom),
    rows: flatten(await treeNodes($, flow, at), new Set(await read($, expandedAtom))),
    details: await read($, detailsAtom),
    isHidingFinished: await read($, hideFinishedAtom),
    isWaiting: (await waitingLoops($)).has(MAIN),
    activity: (await read($, isMainIdleAtom)) ? null : await read($, mainActivityAtom),
  }
}

const anchorToStep = async ($: $, id: string) => {
  const anchor = stepAnchor(await findWorkflow($))
  if (anchor !== undefined) await update($, stepOfAtom, map => ({ ...map, [id]: anchor }))
}

const USAGE =
  '/flow-view opens the pane, or focuses it when open · /flow-view attach <part of a state file name> · /flow-view close · /flow-view min · /flow-view finished'

// Opening an id that is already open only retitles it and drops `focus`, so a fresh instance is what takes the keyboard.
const focusPane = async ($: $): Promise<string> => {
  await $.ui.close({ id: PANE })
  return showPane($)
}

const runCommand = async ($: $, args: string): Promise<string> => {
  const word = args.trim()
  const isOpen = (await read($, modeAtom)) === 'pane'

  await claimFromHistory($)
  if (word.startsWith('attach ')) return attach($, word.slice('attach '.length).trim())
  if (word === '') return isOpen ? focusPane($) : showPane($)
  if (word === 'close') return closeAll($)
  if (word === 'min') {
    await minimize($)
    return 'Flow view minimized to the status line.'
  }
  if (word === 'finished') {
    await toggleFinished($)
    return (await read($, hideFinishedAtom)) ? 'Finished agents hidden.' : 'Finished agents shown.'
  }

  return USAGE
}

const newReviewer = (e: { tool_use_id: string; command: string; agentId?: string }, at: number): Reviewer | undefined => {
  const kind = reviewerKind(e.command)
  if (kind === undefined) return undefined

  const model = modelOf(e.command)

  return {
    id: e.tool_use_id,
    kind,
    label: `${kind} review${model === '' ? '' : ` · ${model}`}`,
    parentId: e.agentId,
    logPath: logPath(e.command),
    logToken: logToken(e.command),
    startedAt: at,
    logBytes: 0,
    grewAt: at,
  }
}

const stdoutOf = (result: unknown): string =>
  typeof result === 'object' && result !== null && 'stdout' in result && typeof result.stdout === 'string'
    ? result.stdout
    : ''

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flow-view',
      description: 'Open or focus the flow pane; close, min and finished are its other actions',
      argumentHint: '[attach <name>|close|min|finished]',
    })
    $.clock.every(TICK_MS, () => void tick($))

    return next(e)
  })

  on('command.run', { command: 'flow-view' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  // The control row is reached by its hotkeys only, so Tab and the arrows walk the tree alone.
  on('ui.focus', { requestId: PANE }, ($, e, next) =>
    e.element?.startsWith(CONTROL) === true && e.origin.kind === 'person' ? { deny: 'hotkey only' } : next(e),
  )

  on('ui.close', async ($, e, next) => {
    if (e.id === AGENT_PANE) await update($, openedAtom, () => null)
    if (e.id === PANE && e.origin.kind === 'person') await update($, modeAtom, () => 'closed')

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const reviewer = newReviewer(e, await $.clock.now())
    // Recorded only after the shell has spawned, so the first liveness check can't miss the process.
    const ran = await next(e)

    // A call returning says nothing about a reviewer started with `&`, so liveness alone decides when it ended.
    if (reviewer !== undefined) {
      await update($, reviewersAtom, list => [...list, reviewer].slice(-30))
      await anchorToStep($, reviewer.id)
    }

    const url = /\bgh\s+pr\s+create\b/.test(e.command) ? pullRequestUrl(stdoutOf(ran.result)) : undefined
    if (url !== undefined) await update($, prUrlAtom, () => url)

    return ran
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    const isQuestion = String(e.tool) === 'AskUserQuestion'
    await update($, inFlightAtom, map => ({ ...map, [id]: e.agentId ?? MAIN }))
    if (isQuestion) await update($, askingAtom, ids => [...ids, id])
    if (WRITERS.has(String(e.tool)) && 'file_path' in e) await claimStateFile($, e.file_path)
    if (e.agentId === undefined) {
      const activity: Activity = { tool: String(e.tool), gist: inputGist(e as Record<string, unknown>), at: await $.clock.now() }
      await update($, mainActivityAtom, () => activity)
    }

    try {
      return await next(e)
    } finally {
      await update($, askingAtom, ids => ids.filter(one => one !== id))
      await update($, inFlightAtom, ({ [id]: _, ...rest }) => rest)
    }
  })

  on('turn.start', async ($, e, next) => {
    await update($, isMainIdleAtom, () => false)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, isMainIdleAtom, () => true)

    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (verdict.decision === 'ask' && id !== undefined) await update($, askingAtom, ids => [...ids, id])

    return verdict
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const at = await $.clock.now()
    await update($, lastSkillAtom, () => ({ name: e.skill, at }))
    if (REVIEW_SKILL.test(e.skill)) await update($, reviewLoopAtAtom, () => at)
    if (FLOW_SKILL.test(e.skill)) await showStatusLine($)

    return next(e)
  })

  on('tool.call', { tool: 'ScheduleWakeup' }, async ($, e, next) => {
    const at = await $.clock.now()
    const due = e.stop === true || e.delaySeconds === undefined ? null : at + e.delaySeconds * 1000
    await update($, wakeAtAtom, () => due)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const { agentId } = spawned
    if (agentId !== undefined) {
      const at = await $.clock.now()
      await update($, spawnedAtAtom, map => ({ ...map, [agentId]: at }))
      await anchorToStep($, agentId)
    }

    return spawned
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    flowPane($, $.ui.resolve(e), await paneData($)),
  )

  on('ui.render', { component: 'Pane', requestId: AGENT_PANE }, async ($, e) => {
    const id = await read($, openedAtom)
    const details = await read($, detailsAtom)

    return agentPane($.ui.resolve(e), id === null ? [] : (details[`full:${id}`] ?? []))
  })
}
