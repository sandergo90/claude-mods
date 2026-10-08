import type { AgentStatus, SessionMessage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { dependencyOrder } from '../hooks/glyphs'
import { locate, parseTicket, ticketState } from '../hooks/tickets'
import type { BoardAgent } from '../types'

const IMPLEMENT_TICKET = `# 02: Rename the dossier

**What to build:** The aanvrager sees their dossiernaam, at most 120 characters.

**Blocked by:** 01: Write and save text in the dossier document (keeps the migrations in one line)

**Status:** done

- [x] Through the HTTP API: a new dossier reads with \`name: null\`.
- [ ] Frontend: the page shows "Naamloos dossier".

## Comments

**Status:** open
- [ ] not an acceptance check
`

const WAYFINDER_TICKET = `# 04: Upload a PDF in the documents step

Type: task
Status: claimed
Blocked by: 01, 03

## Question
`

describe('ticket files', () => {
  test('reads the bold implement-spec format and ignores the comments', async () => {
    const ticket = parseTicket('02-rename-the-dossier.md', IMPLEMENT_TICKET)

    expect(ticket).toEqual({
      number: '02',
      title: 'Rename the dossier',
      status: 'done',
      isDone: true,
      blockedBy: ['01'],
      checksDone: 1,
      checksTotal: 2,
    })
  })

  test('reads the plain wayfinder format', async () => {
    const ticket = parseTicket('04-upload-a-pdf.md', WAYFINDER_TICKET)

    expect(ticket?.isDone).toBe(false)
    expect(ticket?.blockedBy).toEqual(['01', '03'])
  })
})

describe('matching agents to tickets', () => {
  test('the name wins over earlier tickets the prompt points at', async () => {
    const prompt =
      'Implement ticket `.scratch/vi-8-open-dossier/issues/03-home-page.md`; ticket 02\'s notes (`.scratch/vi-8-open-dossier/issues/02-test-login.md`) show what exists.'

    expect(locate(prompt, 'VI-8-03')).toEqual({ feature: 'vi-8-open-dossier', ticket: '03', role: 'implement' })
    expect(locate(prompt, 'merge-VI-8-03').role).toBe('merge')
  })

  test('an agent over the whole feature is a helper, one outside .scratch is not on the board', async () => {
    const review = 'Spec review. Spec: .scratch/vi-9-edit-dossier-text/spec.md. Tickets in .scratch/vi-9-edit-dossier-text/issues/ 01–05.'

    expect(locate(review, 'review-spec')).toEqual({ feature: 'vi-9-edit-dossier-text', role: 'helper' })
    expect(locate('Research rich-text editors.', 'research').feature).toBeUndefined()
  })
})

describe('ticket state', () => {
  const ticket = (number: string, isDone: boolean, blockedBy: string[] = []) => ({
    number,
    title: number,
    status: isDone ? 'done' : '',
    isDone,
    blockedBy,
    checksDone: 0,
    checksTotal: 0,
  })

  test('a ticket waits on its open blockers and is ready once they are done', async () => {
    const third = ticket('03', false, ['01', '02'])

    expect(ticketState(third, [ticket('01', true), ticket('02', false), third], []).label).toBe('blocked by 02')
    expect(ticketState(third, [ticket('01', true), ticket('02', true), third], []).label).toBe('ready')
  })

  test('a finished implementer on an unresolved ticket asks for a merge', async () => {
    const agent: BoardAgent = {
      id: 'a1',
      name: 'VI-9-02',
      feature: 'f',
      ticket: '02',
      role: 'implement',
      run: 'done',
      isWorktree: true,
      startedAt: 0,
      tools: 3,
    }

    expect(ticketState(ticket('02', false), [ticket('02', false)], [agent]).label).toBe('needs merge')
  })
})

describe('line map', () => {
  test('a blocker comes before the ticket it blocks, whatever their numbers', async () => {
    const ticket = (number: string, blockedBy: string[] = []) => ({
      number,
      title: number,
      status: '',
      isDone: false,
      blockedBy,
      checksDone: 0,
      checksTotal: 0,
    })

    const order = dependencyOrder([ticket('01'), ticket('02', ['03']), ticket('03'), ticket('04', ['02'])])

    expect(order.map(t => t.number)).toEqual(['01', '03', '02', '04'])
  })
})

const PANE = {
  plugin: 'ticket-board',
  component: 'Pane',
  requestId: 'ticket-board',
  props: {
    title: 'Tickets',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const TURN = { durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

test('an agent with background work waits, then needs a merge, and takes a message', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    '/repo/.scratch/vi-9-edit/issues/01-editor.md': '# 01: Editor\n\nStatus: done\n',
    '/repo/.scratch/vi-9-edit/issues/02-rename.md': '# 02: Rename the dossier\n\nBlocked by: 01\n\nStatus: open\n',
    '/repo/.scratch/vi-9-edit/issues/03-paste.md': '# 03: Paste\n\nBlocked by: 02\n\nStatus: open\n',
  }
  let status: AgentStatus = 'running'
  const sent: { to: string; text: string }[] = []
  on('session.root', () => ({ value: '/repo' }))
  // The shell moved into the feature folder; the board must not read relative to it.
  on('session.cwd', () => ({ value: '/repo/.scratch/vi-9-edit' }))
  on('fs.list', ($, e) =>
    e.path === '/repo/.scratch/vi-9-edit/issues'
      ? { value: Object.keys(files).map(path => ({ name: path.split('/').pop()!, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
      : { deny: `no folder ${e.path}` },
  )
  on('fs.read', ($, e) => (files[e.path] === undefined ? { deny: `no file ${e.path}` } : { value: files[e.path]! }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'agent-02' }))
  on('agent.list', () => ({ value: [{ id: 'agent-02', description: '', type: 'general-purpose', status }] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.send', ($, e) => (sent.push({ to: e.to, text: e.text }), { isDelivered: true as const }))
  const messages: SessionMessage[] = [
    { role: 'user', text: 'Implement ticket 02.', toolUses: [] },
    {
      role: 'assistant',
      text: 'Running the tests first.',
      toolUses: [{ tool_use_id: 'toolu_t', tool: 'Bash', input: { command: 'bun run test' }, text: '\n12 pass\n0 fail' }],
    },
    { role: 'user', text: 'keep the 120 limit', toolUses: [] },
  ]
  on('session.messages', () => ({ value: messages }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  await $.agent.spawn({
    tool_use_id: 'toolu_02',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'm',
    background: true,
    fork: false,
    name: 'VI-9-02',
    description: 'VI-9-02 rename',
    prompt: 'Implement ticket .scratch/vi-9-edit/issues/02-rename.md',
  })
  const look = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
    await ui.unmount()
    return texts
  }

  expect(await look()).toEqual(expect.arrayContaining(['In progress', 'Rename the dossier', 'Blocked', 'Waits for VI-9-02']))

  status = 'waiting'
  await $.turn.complete({ ...TURN, agentId: 'agent-02', answer: 'Paused on a background sleep.' })
  await clock.advance(3_000)

  expect(await look()).toEqual(expect.arrayContaining(['In progress', 'Waiting on background work']))

  status = 'completed'
  await $.turn.complete({ ...TURN, agentId: 'agent-02', answer: 'Renamed the dossier.' })
  await clock.advance(3_000)

  expect(await look()).toEqual(
    expect.arrayContaining(['Needs you', 'Finished. Merge its work to close the ticket.']),
  )

  const board = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await board.press({ key: 'transcript-agent-02' })
  const transcript = (await board.findAll({ type: 'Text' })).map(found => found.text)

  expect(transcript).toEqual(expect.arrayContaining(['Task', '$ bun run test', '  12 pass', 'Message']))
  await board.press({ key: 'back' })
  expect(await board.find({ text: 'Needs you' })).toBeDefined()
  await board.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'message-agent-02' })
    await ui.input({ key: 'compose-agent-02', text: `keep the 120 limit (${surface})` })

    expect(sent.at(-1)).toEqual({ to: 'agent-02', text: `keep the 120 limit (${surface})` })
    expect(await ui.find({ key: 'compose-agent-02' })).toBeUndefined()
    await ui.unmount()
  }
})
