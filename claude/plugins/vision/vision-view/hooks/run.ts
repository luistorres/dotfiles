import type { Check, Run, Shape, Task } from '../types'

type Section = { heading: string; body: string }

const PULL_REQUEST = /https:\/\/github\.com\/[^\s/)]+\/[^\s/)]+\/pull\/\d+/g

const frontMatter = (text: string): Map<string, string> => {
  const block = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
  const pairs = block.split('\n').flatMap(line => {
    const match = line.match(/^([A-Za-z][\w -]*):\s*(.*)$/)
    return match === null ? [] : [[match[1]?.trim() ?? '', match[2]?.trim() ?? ''] as const]
  })

  return new Map(pairs)
}

const sections = (text: string): Section[] =>
  text
    .split(/^## /m)
    .slice(1)
    .map(chunk => {
      const newline = chunk.indexOf('\n')
      return newline === -1
        ? { heading: chunk.trim(), body: '' }
        : { heading: chunk.slice(0, newline).trim(), body: chunk.slice(newline + 1) }
    })

const checks = (line: string): Check[] =>
  [...line.matchAll(/\[([ xX])\]\s*([^·[\]\n]+)/g)].map(([, mark, label]) => ({
    label: (label ?? '').trim(),
    isDone: mark !== ' ',
  }))

const stepLine = (body: string): string => body.match(/^\s*-?\s*\[[ xX]\][^\n]*·[^\n]*$/m)?.[0] ?? ''

const items = (body: string): Check[] =>
  [...body.matchAll(/^\s*- \[([ xX])\]\s+(.+)$/gm)].map(([, mark, label]) => ({
    label: (label ?? '').trim(),
    isDone: mark !== ' ',
  }))

const subsection = (body: string, heading: string): string =>
  body.split(new RegExp(`^###\\s+${heading}\\s*$`, 'mi'))[1]?.split(/^###\s/m)[0] ?? ''

const fields = (body: string): Map<string, string> =>
  new Map(
    [...body.matchAll(/^[ \t]*- \*\*([^*]+?):\*\*[ \t]*(.*)$/gm)].map(([, name, value]) => [name ?? '', (value ?? '').trim()]),
  )

const lastPullRequest = (text: string): string | null => [...text.matchAll(PULL_REQUEST)].at(-1)?.[0] ?? null

const stackTask = (section: Section): Task | undefined => {
  const heading = section.heading.match(/^\[([ xX])\]\s*(.+)$/)
  if (heading === null) return undefined

  const recorded = fields(section.body)
  return {
    title: heading[2]?.trim() ?? '',
    isDone: heading[1] !== ' ',
    steps: checks(stepLine(section.body)),
    criteria: items(subsection(section.body, 'Acceptance criteria')),
    pr: lastPullRequest(recorded.get('PR') ?? ''),
    branch: recorded.get('Branch') ?? '',
  }
}

const issue = (check: Check): Task => ({
  title: check.label.split(' · ')[0]?.trim() ?? check.label,
  isDone: check.isDone,
  steps: [],
  criteria: [],
  pr: null,
  branch: '',
})

const singleTask = (title: string, text: string, all: Section[], meta: Map<string, string>): Task => {
  const steps = checks(stepLine(all.find(one => /^steps$/i.test(one.heading))?.body ?? ''))

  return {
    title,
    isDone: steps.length > 0 && steps.every(step => step.isDone),
    steps,
    criteria: items(all.find(one => /^acceptance criteria$/i.test(one.heading))?.body ?? ''),
    pr: lastPullRequest(text),
    branch: meta.get('Branch') ?? '',
  }
}

const dated = /^\d{4}-\d{2}-\d{2}\s+/

export const parseRun = (path: string, raw: string): Run => {
  const text = raw.replace(/\r\n/g, '\n')
  const meta = frontMatter(text)
  const all = sections(text)
  const title = text.match(/^# (.+)$/m)?.[1]?.trim() ?? path.split('/').at(-1) ?? path
  const stack = all.flatMap(one => stackTask(one) ?? [])
  const issues = items(all.find(one => /^issues$/i.test(one.heading))?.body ?? '').map(issue)
  const declared = meta.get('Shape')
  const shape: Shape =
    declared === 'stack' || declared === 'issues' || declared === 'single'
      ? declared
      : stack.length > 0
        ? 'stack'
        : issues.length > 0
          ? 'issues'
          : 'single'
  const tasks = shape === 'stack' ? stack : shape === 'issues' ? issues : [singleTask(title, text, all, meta)]
  const log = [...(all.find(one => /^log$/i.test(one.heading))?.body ?? '').matchAll(/^- (.+)$/gm)].map(([, line]) =>
    (line ?? '').replace(dated, '').trim(),
  )

  return {
    path,
    title,
    status: meta.get('Status') ?? '',
    shape,
    risk: meta.get('Risk') ?? '',
    isAutonomous: /^granted\b/i.test(meta.get('Autonomy') ?? ''),
    tasks,
    log,
  }
}

export const isFinished = (run: Run): boolean =>
  run.status === 'done' || (run.tasks.length > 0 && run.tasks.every(task => task.isDone))

export type Position = { task: Task; index: number; step: Check | undefined }

export const position = (run: Run): Position | undefined => {
  const index = run.tasks.findIndex(task => !task.isDone)
  const task = run.tasks[index]
  if (task === undefined) return undefined

  return { task, index, step: task.steps.find(step => !step.isDone) }
}

export type Candidate = { path: string; mtimeMs: number; run: Run }

// The run on screen: the one the person attached, else the in-progress run edited last, else one this session finished.
export const pick = (
  candidates: readonly Candidate[],
  pinned: string | null,
  since: number,
): { chosen: Candidate | undefined; others: number } => {
  const runs = candidates.filter(one => one.run.status !== '').sort((a, b) => b.mtimeMs - a.mtimeMs)
  const active = runs.filter(one => one.run.status === 'in_progress')
  const chosen = runs.find(one => one.path === pinned) ?? active[0] ?? runs.find(one => one.mtimeMs >= since)

  return { chosen, others: active.filter(one => one !== chosen).length }
}
