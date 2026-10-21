export type Check = { label: string; isDone: boolean }

export type Task = {
  title: string
  isDone: boolean
  steps: Check[]
  criteria: Check[]
  pr: string | null
}

export type Shape = 'single' | 'stack' | 'issues'

export type Run = {
  path: string
  title: string
  status: string
  shape: Shape
  risk: string
  isAutonomous: boolean
  tasks: Task[]
  log: string[]
}

export type JobStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'ended'

export type Job = {
  id: string
  label: string
  status: JobStatus
  startedAt: number | null
  endedAt: number | null
}

export type PrStatus = {
  state: string
  isDraft: boolean
  passed: number
  failed: number
  pending: number
}

export type Mode = 'closed' | 'pane' | 'line'

declare module 'claude-code' {
  interface PluginState {
    'vision-view': {
      mode: Mode
      checkout: string | null
      pinned: string | null
      run: Run | null
      otherRuns: number
      shells: Job[]
      agents: Job[]
      spawnedAt: Record<string, number>
      endedAt: Record<string, number>
      prs: Record<string, PrStatus>
      asking: string[]
      isMainIdle: boolean
      isShowingFinished: boolean
      sessionStartedAt: number
      now: number
    }
  }
}
