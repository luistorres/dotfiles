import type { Step, TaskDetail, Workflow } from '../types'

const IN_PROGRESS = /^Status:\s*in_progress\s*$/m

export const isInProgress = (text: string): boolean => IN_PROGRESS.test(text)

const STATE_FILE = /(?:^|\/)(docs\/flow\/(?:lean\/[^/]+\.md|plans\/[^/]+-tasks\.md))$/

export const stateFileOf = (filePath: string): string | undefined => filePath.match(STATE_FILE)?.[1]

export const kindOf = (relPath: string): Workflow['kind'] => (relPath.startsWith('docs/flow/lean/') ? 'lean' : 'flow')

const field = (text: string, name: string): string =>
  text.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''

const title = (text: string): string =>
  text.match(/^# (?:Tasks: )?(.+)$/m)?.[1]?.trim() ?? '(untitled)'

const checklist = (line: string): Step[] =>
  [...line.matchAll(/\[( |x)\]\s*([^·[]+)/g)].map(([, mark, label]) => ({
    label: (label ?? '').trim(),
    isDone: mark === 'x',
  }))

const flowTasks = (text: string): Step[] =>
  [...text.matchAll(/^## \[( |x)\] (Task .+)$/gm)].map(([, mark, label]) => ({
    label: label ?? '',
    isDone: mark === 'x',
  }))

const taskBlock = (text: string, task: Step | undefined): string => {
  if (task === undefined) return ''

  const start = text.indexOf(task.label)
  const end = text.indexOf('\n## ', start)

  return text.slice(start, end === -1 ? undefined : end)
}

const section = (text: string, heading: string): string =>
  text.split(new RegExp(`^## ${heading}\\s*$`, 'm'))[1]?.split(/^## /m)[0] ?? ''

const criteria = (text: string): Step[] =>
  [...section(text, 'Acceptance criteria').matchAll(/^- \[( |x)\] (.+)$/gm)].map(([, mark, label]) => ({
    label: (label ?? '').trim(),
    isDone: mark === 'x',
  }))

const approach = (text: string): string[] =>
  section(text, 'Approach')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')

// The lines lean-flow writes between the title and the first section: links it framed the run with.
const intro = (text: string): string[] =>
  (text.split(/^# .+$/m)[1]?.split(/^## /m)[0] ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')

const fileFields = (text: string): string[] =>
  ['Plan', 'Spec'].flatMap(name => {
    const value = field(text, name).replace(/`/g, '')
    return value === '' ? [] : [`${name}: ${value}`]
  })

const lastPullRequest = (text: string): string | null =>
  [...text.matchAll(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/g)].at(-1)?.[0] ?? null

// One row's worth of a recorded line: no date, its first sentence, and an ellipsis past what a row holds.
export const oneLine = (text: string, limit = 90): string => {
  const sentence = text.replace(/^\d{4}-\d{2}-\d{2}\s+/, '').split(/(?<=[.;])\s+/)[0]?.replace(/[.;]$/, '') ?? ''

  return sentence.length > limit ? `${sentence.slice(0, limit - 1).trimEnd()}…` : sentence
}

const logLines = (text: string): string[] =>
  [...(text.split(/^## Log\s*$/m)[1] ?? '').matchAll(/^- (.+)$/gm)].map(([, line]) => (line ?? '').trim())

const stepLine = (block: string): string => block.match(/^- \[[ x]\] [^\n]*·[^\n]*$/m)?.[0] ?? ''

const SHOWN_FIELDS = new Set(['Status', 'PR', 'Review cycles', 'Review log', 'Completed', 'Branch'])

const taskFields = (block: string): string[] =>
  [...block.matchAll(/^- \*\*([^*]+):\*\* (.+)$/gm)]
    .filter(([, name]) => SHOWN_FIELDS.has(name ?? ''))
    .map(([, name, value]) => oneLine(`${name}: ${value}`))

const taskDetail = (text: string, task: Step): TaskDetail => {
  const block = taskBlock(text, task)

  return {
    label: task.label,
    substeps: checklist(stepLine(block)),
    fields: taskFields(block),
    criteria: criteria(block.replace(/^### /gm, '## ')),
  }
}

const parseFlow = (path: string, text: string): Omit<Workflow, 'updatedAt'> => {
  const steps = flowTasks(text)
  const block = taskBlock(text, steps.find(step => !step.isDone))

  return {
    kind: 'flow',
    path,
    title: title(text),
    headline: field(text, 'Current'),
    isActive: isInProgress(text),
    steps,
    substeps: checklist(stepLine(block)),
    criteria: [],
    approach: [],
    intro: [],
    files: fileFields(text),
    prUrl: lastPullRequest(text),
    absPath: '',
    tasks: steps.map(step => taskDetail(text, step)),
    log: logLines(text),
  }
}

const parseLean = (path: string, text: string): Omit<Workflow, 'updatedAt'> => ({
  kind: 'lean',
  path,
  title: title(text),
  headline: field(text, 'Branch'),
  isActive: isInProgress(text),
  steps: checklist(text.match(/^## Steps\s*\n-?\s*(.+)$/m)?.[1] ?? ''),
  substeps: [],
  criteria: criteria(text),
  approach: approach(text),
  intro: intro(text),
  files: [],
  prUrl: lastPullRequest(text),
  absPath: '',
  tasks: [],
  log: logLines(text),
})

export const parseWorkflow = (kind: Workflow['kind'], path: string, text: string): Omit<Workflow, 'updatedAt'> =>
  kind === 'flow' ? parseFlow(path, text) : parseLean(path, text)

export const currentStep = (steps: readonly Step[]): Step | undefined => steps.find(step => !step.isDone)
