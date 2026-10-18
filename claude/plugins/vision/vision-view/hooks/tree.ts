import type { PrStatus, Workflow } from '../types'
import { ciLine, nextAction } from './pr'
import { currentStep, oneLine } from './workflow'

export type NodeKind = 'step' | 'group' | 'agent' | 'note' | 'link'

export type Tone = 'run' | 'wait' | 'fail' | 'none'

export type TreeNode = {
  id: string
  parentId?: string
  kind: NodeKind
  label: string
  meta: string
  isLive: boolean
  tone: Tone
}

export type Row = TreeNode & { prefix: string; indent: string; hasChildren: boolean; isOpen: boolean }

export const OTHER = 'other'

// Ids carry the state file's path: every vision run has a step named `build`, and one run's agents must not land in another's.
const taskId = (path: string, label: string) => `${path}::${label}`
const subId = (path: string, task: string, label: string) => `${taskId(path, task)}/${label}`

export const anchorPath = (anchor: string): string => anchor.slice(0, anchor.indexOf('::'))

export const stepAnchor = (flow: Workflow | null): string | undefined => {
  const step = flow === null ? undefined : currentStep(flow.steps)
  if (flow === null || step === undefined) return undefined

  const sub = currentStep(flow.substeps)

  return sub === undefined ? taskId(flow.path, step.label) : subId(flow.path, step.label, sub.label)
}

const mark = (isDone: boolean, isCurrent: boolean) => (isDone ? '✓' : isCurrent ? '▶' : '·')

const taskNodes = (flow: Workflow): TreeNode[] => {
  const current = currentStep(flow.steps)

  return flow.steps.map(step => ({
    id: taskId(flow.path, step.label),
    kind: 'step',
    label: `${mark(step.isDone, step === current)} ${step.label}`,
    meta: '',
    isLive: step === current,
    tone: step === current ? 'run' : 'none',
  }))
}

const substepNodes = (flow: Workflow): TreeNode[] => {
  const current = currentStep(flow.steps)
  const sub = currentStep(flow.substeps)
  if (current === undefined) return []

  return flow.substeps.map(step => ({
    id: subId(flow.path, current.label, step.label),
    parentId: taskId(flow.path, current.label),
    kind: 'step',
    label: `${mark(step.isDone, step === sub)} ${step.label}`,
    meta: '',
    isLive: step === sub,
    tone: step === sub ? 'run' : 'none',
  }))
}

const pastSubsteps = (flow: Workflow, anchors: readonly string[], known: ReadonlySet<string>): TreeNode[] =>
  [...new Set(anchors)]
    .filter(anchor => anchorPath(anchor) === flow.path && !known.has(anchor) && anchor.includes('/'))
    .map(anchor => ({
      id: anchor,
      parentId: anchor.slice(0, anchor.indexOf('/')),
      kind: 'step',
      label: `✓ ${anchor.slice(anchor.indexOf('/') + 1)}`,
      meta: '',
      isLive: false,
      tone: 'none',
    }))

const note = (id: string, parentId: string, label: string): TreeNode => ({
  id,
  parentId,
  kind: 'note',
  label,
  meta: '',
  isLive: false,
  tone: 'none',
})

// A link row's label is markdown, so the surface draws it clickable: cmd-click in a terminal, a plain click in the app.
const link = (id: string, parentId: string, markdown: string): TreeNode => ({ ...note(id, parentId, markdown), kind: 'link' })

const URL = /https?:\/\/\S+/

const linked = (line: string): string => {
  const url = line.match(URL)?.[0]
  if (url === undefined) return oneLine(line)

  const label = oneLine(line.replace(url, '').replace(/[\s:·-]+$/, '')) || url
  return `[${label}](${url})`
}

export const firstStepId = (flow: Workflow): string | undefined => {
  const first = flow.steps[0]

  return first === undefined ? undefined : taskId(flow.path, first.label)
}

const planNodes = (flow: Workflow): TreeNode[] => {
  const parent = firstStepId(flow)
  if (parent === undefined || flow.kind !== 'single') return []

  const id = `${flow.path}::plan`
  const met = flow.criteria.filter(one => one.isDone).length
  const count = met > 0 ? `${met}/${flow.criteria.length} criteria met` : `${flow.criteria.length} acceptance criteria`
  const plan: TreeNode = { id, parentId: parent, kind: 'group', label: `Plan · ${count}`, meta: '', isLive: false, tone: 'none' }
  const hasPlan = flow.criteria.length > 0 || flow.approach.length > 0
  const file = flow.absPath === '' ? flow.path : `file://${encodeURI(flow.absPath)}`

  return [
    link(`${flow.path}::file`, parent, `[State file · ${flow.path.split('/').at(-1)}](${file})`),
    ...flow.intro.map((line, index) =>
      URL.test(line) ? link(`${flow.path}::intro/${index}`, parent, linked(line)) : note(`${flow.path}::intro/${index}`, parent, oneLine(line)),
    ),
    ...(hasPlan ? [plan] : []),
    ...flow.criteria.map((one, index) => note(`${id}/c${index}`, id, `${one.isDone ? '✓' : '·'} ${oneLine(one.label, 80)}`)),
    ...flow.approach.map((line, index) => note(`${id}/a${index}`, id, `↳ ${oneLine(line, 80)}`)),
  ]
}

const lastStepId = (flow: Workflow): string | undefined => {
  const last = flow.steps.at(-1)

  return last === undefined ? undefined : taskId(flow.path, last.label)
}

// The ship step answers three questions — where is the PR, is CI green, what is left to do — so it shows those instead of its log.
export const shipNodes = (flow: Workflow | null, pr: PrStatus | null): TreeNode[] => {
  const parent = flow === null || flow.kind !== 'single' || flow.prUrl === null ? undefined : lastStepId(flow)
  if (flow === null || parent === undefined || flow.prUrl === null) return []

  const id = `${flow.path}::pr`
  const status = pr !== null && pr.url === flow.prUrl ? pr : null
  const draft = status?.isDraft === true ? ' · draft' : ''
  const number = flow.prUrl.split('/').at(-1)

  return [
    link(id, parent, `[PR #${number}${draft}](${flow.prUrl})`),
    ...(status === null
      ? [note(`${id}/loading`, parent, 'Checking CI…')]
      : [note(`${id}/ci`, parent, ciLine(status)), note(`${id}/next`, parent, nextAction(status))]),
  ]
}

const stepName = (label: string) => label.split(/[\s(]/)[0]?.toLowerCase() ?? ''

// The log is chronological and names its step by word ("framed", "build green"); a line naming none continues the step before it.
const logStep = (flow: Workflow, line: string): string | undefined => {
  const lower = line.toLowerCase()
  const step = flow.steps.find(step => {
    const name = stepName(step.label)
    return name.length > 2 && lower.includes(name.slice(0, Math.max(3, name.length - 1)))
  })

  return step === undefined ? undefined : taskId(flow.path, step.label)
}

const logNodes = (flow: Workflow): TreeNode[] => {
  let previous = firstStepId(flow)
  const ship = flow.prUrl === null ? undefined : lastStepId(flow)

  return flow.log.flatMap((line, index) => {
    previous = logStep(flow, line) ?? previous
    if (previous === undefined || previous === ship) return []
    return [note(`${flow.path}::log/${index}`, previous, `› ${oneLine(line)}`)]
  })
}

// A flow task carries its own record in the tasks file: its step checklist, outcome fields and acceptance criteria.
const taskRecordNodes = (flow: Workflow, anchors: ReadonlySet<string>): TreeNode[] =>
  flow.tasks.flatMap(task => {
    const parent = taskId(flow.path, task.label)
    const isCurrent = task.label === currentStep(flow.steps)?.label
    const steps = isCurrent
      ? []
      : task.substeps.map(step => {
          const node = note(subId(flow.path, task.label, step.label), parent, `${step.isDone ? '✓' : '·'} ${step.label}`)
          return anchors.has(node.id) ? { ...node, kind: 'step' as const } : node
        })
    const fields = task.fields.map((field, index) => note(`${parent}/f${index}`, parent, field))
    const criteriaId = `${parent}/criteria`
    const met = task.criteria.filter(one => one.isDone).length
    const criteria: TreeNode[] =
      task.criteria.length === 0
        ? []
        : [
            { id: criteriaId, parentId: parent, kind: 'group', label: met > 0 ? `Criteria · ${met}/${task.criteria.length} met` : `${task.criteria.length} acceptance criteria`, meta: '', isLive: false, tone: 'none' },
            ...task.criteria.map((one, index) => note(`${criteriaId}/${index}`, criteriaId, `${one.isDone ? '✓' : '·'} ${oneLine(one.label, 80)}`)),
          ]

    return [...fields, ...steps, ...criteria]
  })

export const stepNodes = (flow: Workflow | null, anchors: readonly string[]): TreeNode[] => {
  if (flow === null) return []

  const steps = [...taskNodes(flow), ...substepNodes(flow)]
  const known = new Set(steps.map(node => node.id))

  const records = taskRecordNodes(flow, new Set(anchors)).filter(node => !known.has(node.id))
  const recorded = new Set(records.map(node => node.id))
  const past = pastSubsteps(flow, anchors, known).filter(node => !recorded.has(node.id))

  return [...steps, ...records, ...past, ...planNodes(flow), ...logNodes(flow)]
}

const parentWithin = (ids: ReadonlySet<string>) => (node: TreeNode) =>
  node.parentId !== undefined && ids.has(node.parentId) ? node.parentId : undefined

const liveBelow = (nodes: readonly TreeNode[], parentOf: (node: TreeNode) => string | undefined) => {
  const live = new Set<string>()
  for (const node of nodes.filter(one => one.isLive)) {
    for (let id = parentOf(node); id !== undefined && !live.has(id); ) {
      live.add(id)
      const parent = nodes.find(one => one.id === id)
      id = parent === undefined ? undefined : parentOf(parent)
    }
  }

  return live
}

// Steps start open while they or something under them is running; agents start closed. A toggle flips the default.
export const flatten = (nodes: readonly TreeNode[], toggled: ReadonlySet<string>): Row[] => {
  const parentOf = parentWithin(new Set(nodes.map(node => node.id)))
  const hasLiveBelow = liveBelow(nodes, parentOf)
  const isOpen = (node: TreeNode) =>
    (node.kind !== 'agent' && (node.isLive || hasLiveBelow.has(node.id))) !== toggled.has(node.id)

  const walk = (parent: string | undefined, indent: string): Row[] => {
    const children = nodes.filter(node => parentOf(node) === parent)

    return children.flatMap((node, index) => {
      const isLast = index === children.length - 1
      const childIndent = indent + (isLast ? '  ' : '│ ')
      const hasChildren = nodes.some(one => parentOf(one) === node.id)
      const open = isOpen(node)
      const row: Row = { ...node, prefix: indent + (isLast ? '└ ' : '├ '), indent: childIndent, hasChildren, isOpen: open }

      return [row, ...(open ? walk(node.id, childIndent) : [])]
    })
  }

  return walk(undefined, '')
}

export const withoutFinished = (nodes: readonly TreeNode[]): TreeNode[] => {
  const parentOf = parentWithin(new Set(nodes.map(node => node.id)))
  const keep = liveBelow(nodes, parentOf)

  return nodes.filter(node => node.kind !== 'agent' || node.isLive || keep.has(node.id))
}

export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))

  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`

  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}
