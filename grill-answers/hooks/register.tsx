import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { GrillQuestion, GrillRound } from '../types'

const round = atom({ plugin: 'grill-answers', key: 'round' } as const, null as GrillRound | null)

// The grilling skill's round: `❓ **Q1** - **<title>**: <question>`, then `➡️ <recommended answer>`.
const QUESTION = /❓\s*\*\*Q(\d+)\*\*\s*-\s*\*\*(.+?)\*\*/g

// A title is shown as plain text: without its markdown emphasis and code ticks.
const plain = (markdown: string) => markdown.replace(/\*\*|__|`/g, '').replace(/:$/, '').trim()

const parseRound = (answer: string): GrillRound | null => {
  const questions: GrillQuestion[] = [...answer.matchAll(QUESTION)].map(([, number = '', title = '']) => ({
    number,
    title: plain(title),
  }))

  return questions.length > 0 && answer.includes('➡️') ? { questions, accepted: [] } : null
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, round, () => parseRound(e.answer))
    }

    return next(e)
  })

  // Any prompt, clicked or typed, answers the round.
  on('prompt.submit', async ($, e, next) => {
    await update($, round, () => null)

    return next(e)
  })

  // The answer panel: the reply stays as the app draws it, the answers are given here, beside the prompt box.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, round)

    if (current === null || e.props.hasSurvey || e.props.isWorking) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const isSingle = current.questions.length === 1

    const send = async (text: string) => {
      // The plugin's own submit skips its own prompt.submit hook, so the click retires the panel itself.
      await update($, round, () => null)
      await $.prompt.submit({ text, asUser: true })
    }

    // Puts the question's line into the prompt box, in place of one it already has there.
    const answer = async (question: string, text: string) => {
      const draft = await $.prompt.read()
      const others = draft.text.split('\n').filter(line => line.trim() !== '' && !line.startsWith(`Q${question}:`))
      await $.prompt.fill({ text: [...others, `Q${question}: ${text}`].join('\n') })
    }

    const accept = async (question: string) => {
      if (isSingle) {
        return send('yes')
      }
      await update($, round, r => (r === null ? r : { ...r, accepted: [...r.accepted.filter(n => n !== question), question] }))
      await answer(question, 'yes')
    }

    const change = async (question: string) => {
      await update($, round, r => (r === null ? r : { ...r, accepted: r.accepted.filter(n => n !== question) }))
      await answer(question, '')
    }

    // One quiet row per question: its number as a column, its title to read, its two answers on the right.
    // The footer carries the only filled button, beside how far the round is answered.
    return (
      <Box flexDirection="column" width="100%" paddingX={1} rowGap={1}>
        {current.questions.map(question => {
          const isAccepted = current.accepted.includes(question.number)

          return (
            <Box key={`row-${question.number}`} width="100%" alignItems="center" justifyContent="space-between" gap={2}>
              <Box flexShrink={1} gap={1}>
                <Box width={5} flexShrink={0}>
                  {isAccepted ? <Text color="success">✓ Q{question.number}</Text> : <Text dimColor>Q{question.number}</Text>}
                </Box>
                <Text wrap="truncate-end">{question.title}</Text>
              </Box>
              <Box gap={1} flexShrink={0}>
                <Button
                  key={`accept-${question.number}`}
                  label={isSingle ? 'Yes' : isAccepted ? 'Accepted' : 'Accept'}
                  dimColor={isAccepted}
                  onPress={() => accept(question.number)}
                />
                <Button key={`change-${question.number}`} label="Change" dimColor onPress={() => change(question.number)} />
              </Box>
            </Box>
          )
        })}
        {isSingle ? null : (
          <Box width="100%" alignItems="center" justifyContent="space-between" marginTop={1}>
            <Text dimColor>
              {current.accepted.length} of {current.questions.length} accepted
            </Text>
            <Button key="accept-all" variant="primary" label="Yes to all" onPress={() => send('yes to all')} />
          </Box>
        )}
      </Box>
    )
  })
}
