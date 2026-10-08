import type { AgentRole, BoardAgent, TicketFile } from '../types'

const DONE = /^(done|resolved|closed|complete|completed|merged)\b/i
const NONE = /^(none|n\/a|-|—)?\s*$/i

export function parseTicket(fileName: string, text: string): TicketFile | undefined {
  const number = /^(\d+)-/.exec(fileName)?.[1]
  if (number === undefined) return undefined

  // Fields and acceptance checks sit above the notes; `## Comments` and `## Answer`
  // quote other tickets' statuses and must not count.
  const lines = text.split('\n')
  const notesAt = lines.findIndex(line => /^##\s+(comments|answer)\b/i.test(line))
  const body = notesAt === -1 ? lines : lines.slice(0, notesAt)

  const heading = body.find(line => line.startsWith('# '))
  const title = heading
    ? heading.slice(2).replace(/^\d+\s*[:.]\s*/, '').trim()
    : fileName.replace(/\.md$/, '')
  const status = field(body, 'Status') ?? ''
  const blocked = field(body, 'Blocked by') ?? ''
  const checks = body.filter(line => /^\s*[-*]\s+\[[ xX]\]/.test(line))

  return {
    number,
    title,
    status,
    isDone: DONE.test(status),
    blockedBy: NONE.test(blocked) ? [] : numbersIn(blocked),
    checksDone: checks.filter(line => /\[[xX]\]/.test(line)).length,
    checksTotal: checks.length,
  }
}

/** Reads both `Status: resolved` and `**Status:** done`. */
function field(lines: string[], name: string): string | undefined {
  const pattern = new RegExp(`^\\*{0,2}${name}\\*{0,2}\\s*:\\s*\\*{0,2}\\s*(.*)$`, 'i')
  for (const line of lines) {
    const match = pattern.exec(line.trim())
    if (match) return (match[1] ?? '').trim()
  }
  return undefined
}

/** `01: Write and save text (keeps 120 characters)` is ticket 01 alone: a number counts only at the start of a list item. */
function numbersIn(value: string): string[] {
  const found = [...value.matchAll(/(?:^|[,;&]|\band\b)\s*#?(\d{1,3})\b/gi)].flatMap(m => (m[1] === undefined ? [] : [m[1]]))
  return [...new Set(found)]
}

export function sameNumber(a: string, b: string): boolean {
  return Number(a) === Number(b)
}

/**
 * Which feature and ticket an Agent call works on. The name wins (`VI-9-02`,
 * `merge-VI-9-02`), since an implementer's prompt may point at earlier tickets'
 * notes; otherwise the one ticket file its prompt names.
 */
export function locate(prompt: string, name?: string): { feature?: string; ticket?: string; role: AgentRole } {
  const feature = /\.scratch\/([\w.-]+)\/(?:issues\/|spec\.md|map\.md)/.exec(prompt)?.[1]
  const role: AgentRole = name !== undefined && /^merge/i.test(name) ? 'merge' : 'implement'
  if (feature === undefined) return { role: 'helper' }

  const fromName = name === undefined ? undefined : /-(\d{2,3})$/.exec(name)?.[1]
  const escaped = feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const named = new Set(
    [...prompt.matchAll(new RegExp(`\\.scratch/${escaped}/issues/(\\d+)-`, 'g'))].flatMap(m => (m[1] === undefined ? [] : [m[1]])),
  )
  const ticket = fromName ?? (named.size === 1 ? [...named][0] : undefined)

  return ticket === undefined ? { feature, role: 'helper' } : { feature, ticket, role }
}

export type Tone = 'done' | 'running' | 'waiting' | 'attention' | 'failed' | 'ready' | 'blocked'

/** One ticket's place on the board: its file's status first, then its agents, then its blockers. */
export function ticketState(
  ticket: TicketFile,
  all: TicketFile[],
  agents: BoardAgent[],
): { label: string; tone: Tone } {
  if (ticket.isDone) return { label: 'done', tone: 'done' }

  const latest = [...agents].sort((a, b) => b.startedAt - a.startedAt)[0]
  if (agents.some(agent => agent.run === 'running')) return { label: 'running', tone: 'running' }
  if (agents.some(agent => agent.run === 'waiting')) return { label: 'waiting', tone: 'waiting' }
  if (latest?.run === 'failed') return { label: 'failed', tone: 'failed' }
  if (latest?.run === 'stopped') return { label: 'stopped', tone: 'failed' }
  if (latest?.run === 'done') {
    return { label: latest.role === 'merge' ? 'merged, still open' : 'needs merge', tone: 'attention' }
  }

  const open = openBlockers(ticket, all)
  if (open.length > 0) return { label: `blocked by ${open.join(', ')}`, tone: 'blocked' }

  return { label: 'ready', tone: 'ready' }
}

export function openBlockers(ticket: TicketFile, all: TicketFile[]): string[] {
  return ticket.blockedBy.filter(number => {
    const blocker = all.find(other => sameNumber(other.number, number))
    return blocker !== undefined && !blocker.isDone
  })
}

/** A short line on what an agent is doing, from the tool call it just made. */
export function activityOf(tool: string, input: Record<string, unknown>): string {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined)
  const file = text('file_path') ?? text('notebook_path') ?? text('path')
  if (tool === 'Bash') return `$ ${(text('command') ?? '').split('\n')[0]}`
  if (tool === 'Skill') return `skill ${text('skill') ?? ''}`
  if (file !== undefined) return `${tool} ${file.split('/').slice(-2).join('/')}`
  if (text('pattern') !== undefined) return `${tool} ${text('pattern')}`

  return tool
}

export function duration(from: number, to: number): string {
  const minutes = Math.max(0, Math.round((to - from) / 60_000))
  if (minutes < 1) return 'under a minute'
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}
