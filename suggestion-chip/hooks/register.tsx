import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Suggestion } from '../types'

const suggestion = atom({ plugin: 'suggestion-chip', key: 'suggestion' } as const, null as Suggestion)

export const register: Register = on => {
  // Kept whether or not the box shows it: the chip is still worth a click while a draft hides the dim text.
  on('prompt.suggest', async ($, e, next) => {
    const text = e.text.trim()
    await update($, suggestion, () => (text === '' ? null : text))

    return next(e)
  })

  // A typed prompt answers or overtakes the suggestion.
  on('prompt.submit', async ($, e, next) => {
    await update($, suggestion, () => null)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, suggestion)

    if (text === null || e.props.hasSurvey || e.props.isWorking) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    // Laid out as the bar above it: what it is on the left, the action on the right.
    return (
      <Box width="100%" alignItems="center" justifyContent="space-between" gap={2}>
        <Box flexShrink={1} gap={1}>
          <Text color="claude">✻</Text>
          <Text wrap="truncate-end">{text}</Text>
        </Box>
        <Button
          key="suggestion"
          label="Send"
          onPress={async () => {
            // The plugin's own submit skips its own prompt.submit hook, so the click retires the chip itself.
            await update($, suggestion, () => null)
            await $.prompt.submit({ text, asUser: true })
          }}
        />
      </Box>
    )
  })
}
