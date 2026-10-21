import type { Check, Job, PrStatus, Run, Task } from '../types'
import { isLive } from './jobs'
import { prBadge } from './pr'
import { isFinished, position } from './run'

export type Tone = 'run' | 'wait' | 'fail' | 'done' | 'dim' | 'plain'

export type Line = { text: string; tone: Tone; isBold?: boolean; href?: string }

export type Attention = 'working' | 'asking' | 'idle'

export type Snapshot = {
  run: Run | null
  otherRuns: number
  jobs: readonly Job[]
  prs: Readonly<Record<string, PrStatus>>
  attention: Attention
  isShowingFinished: boolean
  now: number
}

const FINISHED_SHOWN = 8
const LOG_SHOWN = 3

export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`

  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

export const oneLine = (text: string, limit = 80): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat
}

// A Link refuses its whole tree unless href is exactly a URL's own spelling, so anything else stays text.
export const safeHref = (url: string): string | undefined => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.href === url ? url : undefined
  } catch {
    return undefined
  }
}

const line = (text: string, tone: Tone = 'plain', extra: Partial<Line> = {}): Line => ({ text, tone, ...extra })

const stepStrip = (steps: readonly Check[]): string => {
  const current = steps.find(step => !step.isDone)
  return steps.map(step => `${step.label} ${step.isDone ? '✓' : step === current ? '▶' : '·'}`).join('  ')
}

const prLine = (task: Task, prs: Snapshot['prs'], indent: string): Line[] => {
  if (task.pr === null) return []

  const number = task.pr.split('/').at(-1)
  const status = prs[task.pr]
  const badge = status === undefined ? '' : ` · ${prBadge(status)}`
  return [line(`${indent}PR #${number}${badge}`, 'plain', { href: safeHref(task.pr) })]
}

const criteriaLine = (task: Task, indent: string): Line[] => {
  if (task.criteria.length === 0) return []

  const met = task.criteria.filter(one => one.isDone).length
  return [line(`${indent}criteria ${met}/${task.criteria.length} met`, 'dim')]
}

export const attentionLine = (snapshot: Snapshot): Line | undefined => {
  const { run } = snapshot
  if (run === null) return undefined
  if (isFinished(run)) return line('✓ finished', 'done')
  if (snapshot.attention === 'asking') return line('● waiting for your answer', 'wait')
  if (snapshot.attention === 'working') return line('● working', 'run')

  const live = snapshot.jobs.filter(isLive).length
  return live > 0
    ? line(`● waiting on ${live} background ${live === 1 ? 'job' : 'jobs'}`, 'run')
    : line('● waiting for you', 'wait')
}

const summary = (run: Run): string => {
  const at = position(run)
  const parts =
    run.shape === 'single'
      ? [at?.step === undefined ? '' : `at ${at.step.label}`]
      : [
          `${run.tasks.filter(task => task.isDone).length} of ${run.tasks.length} ${run.shape === 'issues' ? 'issues' : 'tasks'} done`,
          at === undefined || run.shape === 'issues' ? '' : `task ${at.index + 1}${at.step === undefined ? '' : ` at ${at.step.label}`}`,
        ]

  return [...parts, run.risk === '' ? '' : `${run.risk} risk`, run.isAutonomous ? 'autonomous' : '']
    .filter(part => part !== '')
    .join(' · ')
}

const taskLines = (run: Run, prs: Snapshot['prs']): Line[] => {
  const current = position(run)

  if (run.shape === 'single') {
    const task = run.tasks[0]
    if (task === undefined) return []
    return [line(stepStrip(task.steps)), ...criteriaLine(task, ''), ...prLine(task, prs, '')]
  }

  return run.tasks.flatMap((task, index) => {
    const isCurrent = current?.index === index
    const mark = task.isDone ? '✓' : isCurrent ? '▶' : '·'
    const head = line(`${mark} ${task.title}`, task.isDone ? 'done' : isCurrent ? 'run' : 'dim', { isBold: isCurrent })
    if (run.shape === 'issues') return [head]
    if (isCurrent) {
      return [head, ...(task.steps.length === 0 ? [] : [line(`   ${stepStrip(task.steps)}`)]), ...criteriaLine(task, '   '), ...prLine(task, prs, '   ')]
    }

    return [head, ...prLine(task, prs, '   ')]
  })
}

const JOB_TONE: Record<Job['status'], Tone> = {
  running: 'run',
  waiting: 'wait',
  done: 'dim',
  failed: 'fail',
  stopped: 'fail',
  ended: 'dim',
}

const JOB_MARK: Record<Job['status'], string> = {
  running: '●',
  waiting: '●',
  done: '✓',
  failed: '✗',
  stopped: '✗',
  ended: '✓',
}

const jobLine = (job: Job, now: number): Line => {
  const time = isLive(job)
    ? job.startedAt === null
      ? job.status
      : `${job.status === 'waiting' ? 'waiting' : 'running'} ${elapsed(now - job.startedAt)}`
    : job.startedAt !== null && job.endedAt !== null
      ? `${job.status === 'ended' ? 'ended' : job.status} after ${elapsed(job.endedAt - job.startedAt)}`
      : job.status

  return line(`${JOB_MARK[job.status]} ${oneLine(job.label, 44)} · ${time}`, JOB_TONE[job.status])
}

const tallyLine = (hidden: readonly Job[], isShowing: boolean): Line[] => {
  if (hidden.length === 0) return []

  const failed = hidden.filter(job => job.status === 'failed' || job.status === 'stopped').length
  const text = `${hidden.length} ${isShowing ? 'earlier ' : ''}finished${failed > 0 ? `, ${failed} failed or stopped` : ''}`
  return [line(isShowing ? text : `${text} · h shows them`, failed > 0 ? 'fail' : 'dim')]
}

const jobLines = (snapshot: Snapshot): Line[] => {
  const live = snapshot.jobs.filter(isLive)
  const finished = snapshot.jobs.filter(job => !isLive(job))
  if (live.length === 0 && finished.length === 0) return []

  const shown = snapshot.isShowingFinished ? finished.slice(-FINISHED_SHOWN) : []
  const tally = tallyLine(finished.slice(0, finished.length - shown.length), shown.length > 0)

  return [
    line('Running', 'plain', { isBold: true }),
    ...(live.length === 0 ? [line('nothing right now', 'dim')] : live.map(job => jobLine(job, snapshot.now))),
    ...(shown.length === 0
      ? tally
      : [line('Finished', 'plain', { isBold: true }), ...tally, ...shown.map(job => jobLine(job, snapshot.now))]),
  ]
}

const logLines = (run: Run): Line[] =>
  run.log.length === 0
    ? []
    : [line('Latest', 'plain', { isBold: true }), ...run.log.slice(-LOG_SHOWN).map(entry => line(oneLine(entry), 'dim'))]

const gap = (lines: readonly Line[]): Line[] => (lines.length === 0 ? [] : [line(''), ...lines])

export const paneLines = (snapshot: Snapshot): Line[] => {
  const { run } = snapshot
  const jobs = jobLines(snapshot)
  if (run === null) {
    return [line('No vision run in this checkout yet.', 'dim'), ...gap(jobs)]
  }

  const attention = attentionLine(snapshot)
  const others =
    snapshot.otherRuns === 0
      ? []
      : [line(`${snapshot.otherRuns} other ${snapshot.otherRuns === 1 ? 'run' : 'runs'} in progress · /vision-view attach <name>`, 'dim')]

  return [
    line(`vision · ${run.title}`, 'plain', { isBold: true }),
    line(summary(run) || run.shape, 'dim'),
    ...(attention === undefined ? [] : [attention]),
    ...gap(taskLines(run, snapshot.prs)),
    ...gap(jobs),
    ...gap(logLines(run)),
    ...gap(others),
  ]
}

export const statusText = (snapshot: Snapshot): string => {
  const { run } = snapshot
  if (run === null) return 'vision · no run yet'
  if (isFinished(run)) return `vision · ${oneLine(run.title, 40)} · finished`

  const at = position(run)
  const where =
    at === undefined
      ? ''
      : run.shape === 'single'
        ? (at.step?.label ?? '')
        : `task ${at.index + 1}/${run.tasks.length}${at.step === undefined ? '' : ` ${at.step.label}`}`
  const live = snapshot.jobs.filter(isLive).length
  const state = snapshot.attention === 'asking' || (snapshot.attention === 'idle' && live === 0) ? 'waiting for you' : ''

  return ['vision', where, live > 0 ? `${live} running` : '', state].filter(part => part !== '').join(' · ')
}
