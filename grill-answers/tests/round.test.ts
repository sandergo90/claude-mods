import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'

const ROUND = `Here's a round about the labels.

❓ **Q1** - **Accept button wording**: Should it keep the label "Yes to all"?

➡️ Yes: keep **"Yes to all"**, so the label says what you're sending.

❓ **Q2** - **Per-question button wording**: Should each button say \`Change Q2\`?

➡️ Yes: keep "Change Q2".`

const SINGLE = `❓ **Q1** - **Single question**: Should it say "Yes"?

➡️ Yes.`

const block = (text: string) => ({ plugin: 'grill-answers', component: 'AssistantMessage', props: { text, isFirstOfReply: true } }) as const

// What sits beneath the plugin: the engine's own drawing of a reply block, its turn end and its prompt box.
const engine = (on: On) => {
  const sent: string[] = []
  const box = { text: '', cursor: 0 }
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => h($.ui.resolve(e).Text, {}, e.props.text) as RenderElement)
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

describe('answering a grill round from inside the text', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`each recommendation is a button where it stands, the text around it kept (${surface})`, async ($, on) => {
      const { sent, box } = engine(on)
      await answered($, ROUND)
      const ui = await $.ui.mount({ ...block(ROUND), surface })

      expect((await ui.find({ key: 'accept-1' }))?.props.label).toBe('➡️ Yes: keep "Yes to all", so the label says what you\'re sending.')
      // The text around the buttons is the engine's own drawing, the recommendation lines cut out of it.
      expect(await ui.find({ type: 'Text', text: /Should each button say `Change Q2`/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /➡️/ })).toBeUndefined()

      await ui.press({ key: 'accept-2' })
      await ui.press({ key: 'change-1' })
      expect(box.text).toBe('Q2: yes\nQ1: ')
      expect((await ui.find({ key: 'accept-2' }))?.props.label).toBe('✓ Yes: keep "Change Q2".')
      expect(sent).toEqual([])

      await ui.press({ key: 'accept-all' })
      expect(sent).toEqual(['yes to all'])
      await ui.redraw()
      expect(await ui.find({ key: 'accept-1' })).toBeUndefined()
      await ui.unmount()
    })
  }

  test('a single question sends its answer from the recommendation itself', async ($, on) => {
    const { sent } = engine(on)
    await answered($, SINGLE)
    const ui = await $.ui.mount({ ...block(SINGLE), surface: 'desktop' })

    expect(await ui.find({ key: 'accept-all' })).toBeUndefined()
    await ui.press({ key: 'accept-1' })
    expect(sent).toEqual(['yes'])
    await ui.unmount()
  })

  test('a reply that is not a round, and a round already answered, stay plain text', async ($, on) => {
    engine(on)
    await answered($, 'Pushed: the marketplace now lists only the ticket board.')
    const plainReply = await $.ui.mount({ ...block('Pushed: the marketplace now lists only the ticket board.'), surface: 'terminal' })
    expect(await plainReply.find({ type: 'Button' })).toBeUndefined()
    await plainReply.unmount()

    await answered($, ROUND)
    await $.prompt.submit({ text: 'Q2 no, use the titles', origin: { kind: 'composer' }, wait: false })
    const old = await $.ui.mount({ ...block(ROUND), surface: 'terminal' })
    expect(await old.find({ type: 'Button' })).toBeUndefined()
    expect(await old.find({ type: 'Text', text: /➡️ Yes: keep "Change Q2"/ })).toBeDefined()
    await old.unmount()
  })
})
