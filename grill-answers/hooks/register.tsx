import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { GrillQuestion, GrillRound } from '../types'

const round = atom({ plugin: 'grill-answers', key: 'round' } as const, null as GrillRound | null)

// The grilling skill's round: `❓ **Q1** - **<title>**: <question>`, then `➡️ <recommended answer>`.
const QUESTION = /❓\s*\*\*Q(\d+)\*\*\s*-\s*\*\*(.+?)\*\*/
const RECOMMENDATION = /^\s*➡️\s*(.+)$/

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

// A button label is plain text: the recommendation without its markdown emphasis and code ticks.
const plain = (markdown: string) => markdown.replace(/\*\*|__|`/g, '').trim()

const parseRound = (answer: string): GrillRound | null => {
  const questions: GrillQuestion[] = [...answer.matchAll(new RegExp(QUESTION, 'g'))].map(([, number = '', title = '']) => ({
    number,
    title: title.replace(/:$/, '').trim(),
  }))

  return questions.length > 0 && answer.includes('➡️') ? { answer: collapse(answer), questions, accepted: [] } : null
}

/** The block's text cut where its recommendations stand: markdown between, each `➡️` line with its question. */
type Piece = { kind: 'text'; markdown: string } | { kind: 'recommendation'; question: string; text: string }

const pieces = (block: string): Piece[] => {
  const out: Piece[] = []
  let markdown: string[] = []
  let question = ''
  const flush = () => {
    if (markdown.join('\n').trim() !== '') {
      out.push({ kind: 'text', markdown: markdown.join('\n') })
    }
    markdown = []
  }

  for (const line of block.split('\n')) {
    question = line.match(QUESTION)?.[1] ?? question
    const recommendation = line.match(RECOMMENDATION)?.[1]
    if (recommendation === undefined || question === '') {
      markdown.push(line)
      continue
    }
    flush()
    out.push({ kind: 'recommendation', question, text: plain(recommendation) })
  }
  flush()

  return out
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

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const current = await read($, round)
    const block = collapse(e.props.text)
    const isRoundEnd = current !== null && block !== '' && !e.props.isSummary && current.answer.endsWith(block)

    if (!isRoundEnd) {
      return next(e)
    }

    const { Box, Button } = $.ui.resolve(e)
    const isSingle = current.questions.length === 1

    // The text between the buttons is drawn by the engine itself, piece by piece, so it keeps the transcript's own look.
    const parts = pieces(e.props.text)
    const drawn: (Awaited<ReturnType<typeof next>> | null)[] = []
    for (const [index, piece] of parts.entries()) {
      drawn.push(
        piece.kind === 'text'
          ? await next({ ...e, props: { ...e.props, text: piece.markdown, isFirstOfReply: e.props.isFirstOfReply && index === 0 } })
          : null,
      )
    }

    const send = async (text: string) => {
      // The plugin's own submit skips its own prompt.submit hook, so the click retires the buttons itself.
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

    return (
      <Box flexDirection="column" gap={1}>
        {parts.map((piece, index) =>
          piece.kind === 'text' ? (
            <Box key={`text-${index}`}>{drawn[index]}</Box>
          ) : (
            <Box key={`row-${piece.question}`} gap={1} alignItems="center" flexWrap="wrap">
              <Button
                key={`accept-${piece.question}`}
                label={`${current.accepted.includes(piece.question) ? '✓' : '➡️'} ${piece.text}`}
                onPress={() => accept(piece.question)}
              />
              <Button key={`change-${piece.question}`} label="Change" dimColor onPress={() => change(piece.question)} />
            </Box>
          ),
        )}
        {isSingle ? null : <Button key="accept-all" variant="primary" label="Yes to all" onPress={() => send('yes to all')} />}
      </Box>
    )
  })
}
