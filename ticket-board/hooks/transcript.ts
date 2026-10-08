import type { SessionMessage } from 'claude-code'

import type { Step } from '../types'
import { activityOf } from './tickets'

const firstLine = (text: string) => text.split('\n').find(line => line.trim() !== '')?.trim() ?? null

/**
 * An agent's messages as steps: its task first, then what it said and each tool it
 * called with the first line of the answer. A later user message with text is one
 * sent to it (a correction); tool results ride on their tool's step instead.
 * A finished agent's rows are read back from disk and may lack fields, so none is assumed.
 */
export function stepsOf(messages: readonly SessionMessage[]): Step[] {
  return messages.flatMap((message, index): Step[] => {
    const text = typeof message.text === 'string' ? message.text.trim() : ''
    if (message.role === 'user') {
      if (text === '') return []
      return [{ kind: index === 0 ? 'task' : 'message', text }]
    }

    const said: Step[] = text === '' ? [] : [{ kind: 'say', text }]
    const tools: Step[] = (Array.isArray(message.toolUses) ? message.toolUses : []).map(use => ({
      kind: 'tool',
      line: activityOf(String(use.tool ?? 'Tool'), use.input ?? {}),
      result: typeof use.text === 'string' ? firstLine(use.text) : null,
      isError: use.isError === true,
    }))
    return [...said, ...tools]
  })
}
