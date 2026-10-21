import type { Job, JobStatus, Shell } from '../types'

export type AgentRow = { id: string; description: string; type: string; status: string }

const STATUS: Record<string, JobStatus> = {
  pending: 'running',
  running: 'running',
  waiting: 'waiting',
  idle: 'done',
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
  stopped: 'stopped',
}

export const jobStatus = (status: string): JobStatus => STATUS[status] ?? 'ended'

export const isLive = (job: Pick<Job, 'status'>): boolean => job.status === 'running' || job.status === 'waiting'

export const agentJob = (agent: AgentRow, startedAt: number | undefined, endedAt: number | undefined): Job => ({
  id: agent.id,
  label: agent.description === '' ? agent.type : `${agent.type} · ${agent.description}`,
  status: jobStatus(agent.status),
  startedAt: startedAt ?? null,
  endedAt: endedAt ?? null,
})

export const shellLabel = (description: unknown, command: unknown): string => {
  if (typeof description === 'string' && description.trim() !== '') return description.trim()

  const first = typeof command === 'string' ? (command.split('\n').find(line => line.trim() !== '') ?? '') : ''
  return first.trim().slice(0, 60) || 'background command'
}

export type Notice = { taskId: string; status: JobStatus }

const tag = (text: string, name: string): string | undefined =>
  text.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`))?.[1]

// Claude Code tells the session a background task ended with a <task-notification> block naming its id and status; one delivery can carry several.
export const noticesOf = (text: string): Notice[] =>
  text.split('<task-notification>').slice(1).flatMap(block => {
    const taskId = tag(block, 'task-id')
    return taskId === undefined || taskId === '' ? [] : [{ taskId, status: jobStatus(tag(block, 'status') ?? 'completed') }]
  })

export const settle = (shells: readonly Shell[], notices: readonly Notice[], at: number): Shell[] =>
  shells.map(shell => {
    const notice = notices.find(one => one.taskId === shell.id)
    return notice === undefined ? shell : { ...shell, status: notice.status, endedAt: shell.endedAt ?? at }
  })

// Only finished commands make room for new ones: a command still running stays listed however many start after it.
export const keepShells = (shells: readonly Shell[], max: number): Shell[] => {
  let excess = shells.length - max
  return shells.filter(shell => {
    if (excess <= 0 || isLive(shell)) return true
    excess -= 1
    return false
  })
}

export type AgentTimes = { started: Record<string, number>; ended: Record<string, number>; resumed: string[] }

// A subagent resumed with SendMessage comes back under the same id, so its clock restarts when it runs again.
export const agentTimes = (agents: readonly AgentRow[], ended: Readonly<Record<string, number>>, at: number): AgentTimes => {
  const times: AgentTimes = { started: {}, ended: {}, resumed: [] }
  for (const agent of agents) {
    const live = isLive({ status: jobStatus(agent.status) })
    if (live && ended[agent.id] !== undefined) {
      times.resumed.push(agent.id)
      times.started[agent.id] = at
    }
    if (!live && ended[agent.id] === undefined) times.ended[agent.id] = at
  }
  return times
}

// The end of each turn lists the background work still in flight; a command missing from it has ended, and its notice says how.
export const reconcile = (shells: readonly Shell[], inFlight: ReadonlySet<string>, at: number): Shell[] =>
  shells.map(shell =>
    isLive(shell) && !inFlight.has(shell.id) ? { ...shell, status: 'ended', endedAt: at } : shell,
  )

export const backgroundTaskId = (result: unknown): string | undefined => {
  if (typeof result !== 'object' || result === null || !('backgroundTaskId' in result)) return undefined

  const id = result.backgroundTaskId
  return typeof id === 'string' && id !== '' ? id : undefined
}
