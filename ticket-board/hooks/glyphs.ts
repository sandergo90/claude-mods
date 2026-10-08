import type { TicketFile } from '../types'
import { sameNumber, type Tone } from './tickets'

/** State colors that read on the host's light and dark theme alike. */
export const COLOR: Record<Tone | 'muted', string> = {
  muted: '#8A909C',
  done: '#4E9A6B',
  running: '#3D7BD9',
  waiting: '#3D7BD9',
  attention: '#D08A1E',
  failed: '#C4473A',
  ready: '#8A909C',
  blocked: '#8A909C',
}

/** The board's columns, left to right: the order a ticket moves through them. */
export const COLUMNS = [
  { id: 'blocked', title: 'Blocked', tones: ['blocked'] },
  { id: 'ready', title: 'Ready', tones: ['ready'] },
  { id: 'progress', title: 'In progress', tones: ['running', 'waiting'] },
  { id: 'attention', title: 'Needs you', tones: ['attention', 'failed'] },
  { id: 'done', title: 'Done', tones: ['done'] },
] as const satisfies readonly { id: string; title: string; tones: readonly Tone[] }[]

export type ColumnId = (typeof COLUMNS)[number]['id']

/** Blockers before the tickets they block, ticket number breaking ties; a cycle keeps file order. */
export function dependencyOrder(tickets: TicketFile[]): TicketFile[] {
  const byNumber = [...tickets].sort((a, b) => Number(a.number) - Number(b.number))
  const placed: TicketFile[] = []
  const pending = new Set(byNumber)

  while (pending.size > 0) {
    const next = [...pending].find(ticket =>
      ticket.blockedBy.every(number => {
        const blocker = byNumber.find(other => sameNumber(other.number, number))
        return blocker === undefined || placed.includes(blocker)
      }),
    )
    const pick = next ?? [...pending][0]!
    placed.push(pick)
    pending.delete(pick)
  }

  return placed
}

const svg = (size: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">` +
  `<style>@media (prefers-reduced-motion:reduce){.pulse{display:none}}</style>${body}</svg>`

/**
 * A column's status icon, in the circle family a work tracker uses: dashed while
 * blocked, an empty ring when ready, half full in progress, marked when it needs
 * someone, filled with a check when done.
 */
export function columnIcon(column: ColumnId): string {
  switch (column) {
    case 'blocked':
      return svg(14, `<circle cx="8" cy="8" r="6" fill="none" stroke="${COLOR.blocked}" stroke-width="1.6" stroke-dasharray="2.2 2.2"/>`)
    case 'ready':
      return svg(14, `<circle cx="8" cy="8" r="6" fill="none" stroke="${COLOR.ready}" stroke-width="1.6"/>`)
    case 'progress':
      return svg(
        14,
        `<circle cx="8" cy="8" r="6" fill="none" stroke="${COLOR.running}" stroke-width="1.6"/><path d="M8 4 A4 4 0 0 1 8 12 Z" fill="${COLOR.running}"/>`,
      )
    case 'attention':
      return svg(
        14,
        `<circle cx="8" cy="8" r="6.6" fill="${COLOR.attention}"/><rect x="7.1" y="4.3" width="1.8" height="4.6" rx=".9" fill="#fff"/><circle cx="8" cy="11.2" r="1.05" fill="#fff"/>`,
      )
    case 'done':
      return svg(
        14,
        `<circle cx="8" cy="8" r="6.6" fill="${COLOR.done}"/><path d="M5.2 8.1 l1.9 1.9 l3.7 -3.8" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
  }
}

/** An agent's dot on its card: pulsing while it works, a hollow ring while it waits. */
export function agentDot(tone: Tone): string {
  const c = COLOR[tone]
  if (tone === 'running') {
    return svg(
      12,
      `<circle class="pulse" cx="8" cy="8" r="3.5" fill="${c}" opacity=".5"><animate attributeName="r" values="3.5;7.5" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".5;0" dur="1.8s" repeatCount="indefinite"/></circle><circle cx="8" cy="8" r="3.5" fill="${c}"/>`,
    )
  }
  if (tone === 'waiting') return svg(12, `<circle cx="8" cy="8" r="3.6" fill="none" stroke="${c}" stroke-width="1.8"/>`)

  return svg(12, `<circle cx="8" cy="8" r="3.5" fill="${c}"/>`)
}

/** The same marks for a surface without Svg. */
export const TEXT_GLYPH: Record<Tone | ColumnId, string> = {
  done: '●',
  running: '◉',
  waiting: '◌',
  attention: '◆',
  failed: '✕',
  ready: '○',
  blocked: '◌',
  progress: '◐',
}
