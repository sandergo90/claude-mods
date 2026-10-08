/** One ticket file, `.scratch/<feature>/issues/NN-slug.md`, as the board reads it. */
export type TicketFile = {
  number: string
  title: string
  status: string
  isDone: boolean
  blockedBy: string[]
  checksDone: number
  checksTotal: number
}

/** `waiting`: its turn ended with background work of its own still out, so it will resume. */
export type AgentRun = 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

/** `implement` and `merge` belong to one ticket; a `helper` (review, fixes) to the feature. */
export type AgentRole = 'implement' | 'merge' | 'helper'

export type BoardAgent = {
  id: string
  name: string
  feature: string
  ticket?: string
  role: AgentRole
  run: AgentRun
  isWorktree: boolean
  startedAt: number
  endedAt?: number
  tools: number
  activity?: string
  answer?: string
  /** How its last turn ended, kept while it waits so the final state is known once it stops. */
  outcome?: 'done' | 'failed' | 'stopped'
}

/** `dir` is the feature's absolute folder, fixed when its first agent starts. */
export type Feature = { slug: string; dir: string; tickets: TicketFile[]; seenAt: number }

declare module 'claude-code' {
  interface PluginState {
    'ticket-board': {
      features: Record<string, Feature>
      agents: Record<string, BoardAgent>
      composing: string | null
      selected: string | null
      showFinished: boolean
    }
  }
}
