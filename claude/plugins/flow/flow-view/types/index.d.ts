export type Step = { label: string; isDone: boolean }

export type TaskDetail = { label: string; substeps: Step[]; fields: string[]; criteria: Step[] }

export type Workflow = {
  kind: 'flow' | 'lean'
  title: string
  path: string
  headline: string
  isActive: boolean
  steps: Step[]
  substeps: Step[]
  criteria: Step[]
  approach: string[]
  intro: string[]
  files: string[]
  prUrl: string | null
  absPath: string
  tasks: TaskDetail[]
  log: string[]
  updatedAt: number
}

export type AgentNode = {
  id: string
  description: string
  type: string
  status: string
  parentId?: string
}

export type ReviewerKind = 'codex' | 'cursor'

export type Reviewer = {
  id: string
  kind: ReviewerKind
  label: string
  parentId?: string
  logPath?: string
  logToken?: string
  startedAt: number
  endedAt?: number
  hasFailed?: boolean
  logBytes: number
  grewAt: number
}

export type Mode = 'closed' | 'pane' | 'line'

export type LastSkill = { name: string; at: number }

export type PrStatus = {
  number: number
  url: string
  state: string
  isDraft: boolean
  reviewDecision: string
  passed: number
  failed: number
  pending: number
  fetchedAt: number
}

export type Activity = { tool: string; gist: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'flow-view': {
      mode: Mode
      workflow: Workflow | null
      agents: AgentNode[]
      spawnedAt: Record<string, number>
      stepOf: Record<string, string>
      ownedPaths: string[]
      inFlight: Record<string, string>
      asking: string[]
      isMainIdle: boolean
      mainActivity: Activity | null
      prStatus: PrStatus | null
      reviewers: Reviewer[]
      lastSkill: LastSkill | null
      reviewLoopAt: number | null
      wakeAt: number | null
      prUrl: string | null
      expanded: string[]
      details: Record<string, string[]>
      hideFinished: boolean
      opened: string | null
      now: number
    }
  }
}
