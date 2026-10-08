import type { SessionMessage } from 'claude-code'

import { activityOf } from './tickets'

/** One step of an agent's conversation, as the board's transcript view draws it. */
export type Step =
  | { kind: 'task'; text: string }
  | { kind: 'message'; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'tool'; line: string; result?: string; isError: boolean }

const firstLine = (text: string) => text.split('\n').find(line => line.trim() !== '')?.trim()

/**
 * An agent's messages as steps: its task first, then what it said and each tool it
 * called with the first line of the answer. A later user message with text is one
 * sent to it (a correction); tool results ride on their tool's step instead.
 */
export function stepsOf(messages: readonly SessionMessage[]): Step[] {
  return messages.flatMap((message, index): Step[] => {
    const text = message.text.trim()
    if (message.role === 'user') {
      if (text === '') return []
      return [{ kind: index === 0 ? 'task' : 'message', text }]
    }

    const said: Step[] = text === '' ? [] : [{ kind: 'say', text }]
    const tools: Step[] = message.toolUses.map(use => ({
      kind: 'tool',
      line: activityOf(use.tool, use.input),
      result: use.text === undefined ? undefined : firstLine(use.text),
      isError: use.isError === true,
    }))
    return [...said, ...tools]
  })
}
