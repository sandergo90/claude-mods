import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'

const ROUND = `Here's a round about the labels.

❓ **Q1** - **Accept button wording**: Should it keep the label "Yes to all"?

➡️ Yes: keep "Yes to all", so the label says what you're sending.

❓ **Q2** - **\`max_tokens\` from 8,000 to 4,000**: Should it drop to 4,000?

➡️ Yes: 4,000, with a metric on the largest output.`

const SINGLE = `❓ **Q1** - **Single question**: Should it say "Yes"?

➡️ Yes.`

const PANEL = { plugin: 'grill-answers', component: 'AbovePrompt' } as const

const props = (isWorking = false) => ({
  hasSurvey: false,
  isWorking,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
})

// What sits beneath the plugin: the engine's empty band, its turn end and its prompt box.
const engine = (on: On) => {
  const sent: string[] = []
  const box = { text: '', cursor: 0 }
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('prompt.read', () => ({ value: { ...box } }))
  on('prompt.fill', ($, e) => {
    box.text = e.mode === 'append' ? box.text + e.text : e.text
    box.cursor = box.text.length
    return { isFilled: true, ...box }
  })
  return { sent, box }
}

const answered = ($: Engine, answer: string) =>
  $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })

describe('answering a grill round from the panel above the prompt', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`each question is a row by its title, answered into the prompt box (${surface})`, async ($, on) => {
      const { sent, box } = engine(on)
      await answered($, ROUND)
      const ui = await $.ui.mount({ ...PANEL, surface, props: props() })

      expect(await ui.find({ type: 'Text', text: 'max_tokens from 8,000 to 4,000' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '0 of 2 accepted' })).toBeDefined()

      await ui.press({ key: 'accept-2' })
      await ui.press({ key: 'change-1' })
      expect(box.text).toBe('Q2: yes\nQ1: ')
      expect(await ui.find({ type: 'Text', text: '✓ Q2' })).toBeDefined()
      expect((await ui.find({ key: 'accept-2' }))?.props.label).toBe('Accepted')
      expect(await ui.find({ type: 'Text', text: '1 of 2 accepted' })).toBeDefined()
      expect(sent).toEqual([])

      await ui.press({ key: 'accept-all' })
      expect(sent).toEqual(['yes to all'])
      await ui.redraw()
      expect(await ui.find({ key: 'accept-1' })).toBeUndefined()
      await ui.unmount()
    })
  }

  test('a single question sends its answer straight away', async ($, on) => {
    const { sent } = engine(on)
    await answered($, SINGLE)
    const ui = await $.ui.mount({ ...PANEL, surface: 'desktop', props: props() })

    expect(await ui.find({ key: 'accept-all' })).toBeUndefined()
    await ui.press({ key: 'accept-1' })
    expect(sent).toEqual(['yes'])
    await ui.unmount()
  })

  test('no panel for a reply that is not a round, while a turn runs, or once the round is answered', async ($, on) => {
    engine(on)
    await answered($, 'Pushed: the marketplace now lists only the ticket board.')
    const plainReply = await $.ui.mount({ ...PANEL, surface: 'terminal', props: props() })
    expect(await plainReply.find({ type: 'Button' })).toBeUndefined()
    await plainReply.unmount()

    await answered($, ROUND)
    const working = await $.ui.mount({ ...PANEL, surface: 'terminal', props: props(true) })
    expect(await working.find({ type: 'Button' })).toBeUndefined()
    await working.unmount()

    await $.prompt.submit({ text: 'Q2 no, keep 8,000', origin: { kind: 'composer' }, wait: false })
    const answeredRound = await $.ui.mount({ ...PANEL, surface: 'terminal', props: props() })
    expect(await answeredRound.find({ type: 'Button' })).toBeUndefined()
    await answeredRound.unmount()
  })
})
