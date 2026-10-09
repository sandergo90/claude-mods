import type { On, RenderElement } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

const props = (isWorking = false) => ({
  hasSurvey: false,
  isWorking,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
})

const BAND = { plugin: 'suggestion-chip', component: 'AbovePrompt' } as const

// The engine's own band beneath the plugin: nothing of its own to show.
const emptyBand = (on: On) => on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)

describe('the suggestion chip', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`a click sends Claude's suggestion as the person's prompt (${surface})`, async ($, on) => {
      emptyBand(on)
      const sent: { text: string; origin: unknown }[] = []
      on('prompt.suggest', () => ({ isShown: true }))
      on('prompt.submit', ($, e) => {
        sent.push({ text: e.text, origin: e.origin })
        return { text: e.text }
      })

      await $.prompt.suggest({ text: '  run the tests you just wrote ', origin: { kind: 'suggestion' } })
      const ui = await $.ui.mount({ ...BAND, surface, props: props() })
      expect(await ui.find({ type: 'Text', text: 'run the tests you just wrote' })).toBeDefined()

      await ui.press({ key: 'suggestion' })

      expect(sent).toEqual([
        { text: 'run the tests you just wrote', origin: { kind: 'plugin', name: 'suggestion-chip', asUser: true } },
      ])
      await ui.redraw()
      expect(await ui.find({ key: 'suggestion' })).toBeUndefined()
      await ui.unmount()
    })
  }

  test('a typed prompt retires the suggestion, and none shows while a turn runs', async ($, on) => {
    emptyBand(on)
    on('prompt.suggest', () => ({ isShown: true }))
    on('prompt.submit', ($, e) => ({ text: e.text }))

    await $.prompt.suggest({ text: 'commit this', origin: { kind: 'suggestion' } })
    const working = await $.ui.mount({ ...BAND, surface: 'terminal', props: props(true) })
    expect(await working.find({ key: 'suggestion' })).toBeUndefined()
    await working.unmount()

    await $.prompt.submit({ text: 'no, first fix the lint', origin: { kind: 'composer' }, wait: false })
    const idle = await $.ui.mount({ ...BAND, surface: 'terminal', props: props() })
    expect(await idle.find({ key: 'suggestion' })).toBeUndefined()
    await idle.unmount()
  })
})
