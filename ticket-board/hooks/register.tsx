import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register } from 'claude-code'

import type { BoardAgent, Feature, TicketFile } from '../types'
import { agentDot, type ColumnId, COLOR, COLUMNS, columnIcon, dependencyOrder, TEXT_GLYPH } from './glyphs'
import type { CardLine, CardProps, Segment } from './card'
import { stepsOf } from './transcript'
import { activityOf, duration, locate, openBlockers, parseTicket, sameNumber, ticketState, type Tone } from './tickets'

const PANE = 'ticket-board'
const REFRESH_MS = 15_000
const SETTLE_MS = 3_000

const features = atom({ plugin: 'ticket-board', key: 'features' } as const, {})
const agents = atom({ plugin: 'ticket-board', key: 'agents' } as const, {})
const composing = atom({ plugin: 'ticket-board', key: 'composing' } as const, null)
const selected = atom({ plugin: 'ticket-board', key: 'selected' } as const, null)
const showFinished = atom({ plugin: 'ticket-board', key: 'showFinished' } as const, false)
const viewing = atom({ plugin: 'ticket-board', key: 'viewing' } as const, null)
const transcript = atom({ plugin: 'ticket-board', key: 'transcript' } as const, null)

type $ = EngineInterface
type Outcome = NonNullable<BoardAgent['outcome']>

const LIVE: ReadonlySet<AgentStatus> = new Set(['pending', 'running', 'waiting'])

/** `undefined` when the folder can't be listed, so a failed read never empties the board. */
async function loadTickets($: $, dir: string): Promise<TicketFile[] | undefined> {
  const entries = await $.fs.list(`${dir}/issues`).catch(() => undefined)
  if (entries === undefined) return undefined

  const files = entries
    .filter(entry => entry.kind === 'file' && /^\d+-.*\.md$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  const tickets = await Promise.all(
    files.map(async entry => {
      const text = await $.fs.read(`${dir}/issues/${entry.name}`).catch(() => undefined)
      return text === undefined ? undefined : parseTicket(entry.name, text)
    }),
  )

  return tickets.filter((ticket): ticket is TicketFile => ticket !== undefined)
}

/** The prompt's own absolute path when it gives one, else the project root: never the shell's cwd. */
async function featureDir($: $, prompt: string, slug: string): Promise<string> {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const absolute = new RegExp(`(/[^\\s\`'"()]*?)/\\.scratch/${escaped}/`).exec(prompt)?.[1]

  return `${absolute ?? (await $.session.root())}/.scratch/${slug}`
}

async function finish($: $, agent: BoardAgent, outcome: Outcome) {
  const now = await $.clock.now()
  await setAgent($, agent.id, one => ({ ...one, run: outcome, endedAt: one.endedAt ?? now, activity: undefined }))
  $.ui.toast(`${agent.name} ${outcome === 'done' ? 'finished' : outcome}`)
}

function outcomeOf(status: AgentStatus | undefined, fallback: Outcome): Outcome {
  if (status === 'failed') return 'failed'
  if (status === 'killed') return 'stopped'
  return fallback
}

/**
 * Settles agents against the engine's own list: a turn that ended with background
 * work out leaves the agent `waiting`, and only a loop the engine no longer runs is final.
 */
async function reconcile($: $) {
  const unsettled = Object.values(await read($, agents)).filter(a => a.run === 'running' || a.run === 'waiting')
  if (unsettled.length === 0) return

  const list = await $.agent.list().catch(() => undefined)
  if (list === undefined) return
  for (const agent of unsettled) {
    const status = list.find(info => info.id === agent.id)?.status
    if (status !== undefined && LIVE.has(status)) continue
    // A running agent missing from the list may not be listed yet; only an ended turn makes absence final.
    if (agent.run === 'running' && status === undefined) continue
    await finish($, agent, outcomeOf(status, agent.outcome ?? 'done'))
  }
}

async function refresh($: $) {
  const root = await $.session.root()
  for (const feature of Object.values(await read($, features))) {
    // State saved before features kept their folder falls back to the project root.
    const dir = feature.dir || `${root}/.scratch/${feature.slug}`
    const tickets = await loadTickets($, dir)
    if (tickets === undefined || (tickets.length === 0 && feature.tickets.length > 0)) continue
    await update($, features, all => {
      const one = all[feature.slug]
      return one === undefined ? all : { ...all, [feature.slug]: { ...one, dir, tickets } }
    })
  }
  await reconcile($)
  await showStatus($)
}

async function current($: $): Promise<Feature | undefined> {
  const all = Object.values(await read($, features)).sort((a, b) => b.seenAt - a.seenAt)
  const pick = await read($, selected)

  return all.find(feature => feature.slug === pick) ?? all[0]
}

async function showStatus($: $) {
  const feature = await current($)
  if (feature === undefined) return $.ui.status(undefined)

  const active = Object.values(await read($, agents)).filter(
    agent => agent.feature === feature.slug && (agent.run === 'running' || agent.run === 'waiting'),
  ).length
  const done = feature.tickets.filter(ticket => ticket.isDone).length
  $.ui.status(`${feature.slug}: ${done} of ${feature.tickets.length} done${active > 0 ? `, ${active} working` : ''}`)
}

async function setAgent($: $, id: string, change: (agent: BoardAgent) => BoardAgent) {
  await update($, agents, all => {
    const agent = all[id]
    return agent === undefined ? all : { ...all, [id]: change(agent) }
  })
}

async function sendMessage($: $, agent: BoardAgent, text: string) {
  const message = text.trim()
  if (message === '') return

  const sent = await $.session.send({ to: { agentId: agent.id }, text: message })
  if (!sent.isDelivered) {
    $.ui.toast(`Not sent to ${agent.name}: ${sent.reason}`)
    return
  }
  // The orchestrating model reads this, so the agent's changed report doesn't surprise it.
  // The message is already delivered, so a refused note must not fail the send.
  await $.session
    .append({
      message: {
        type: 'user',
        content: [{ type: 'text', text: `From the ticket board, the user sent ${agent.name} this message: ${message}` }],
      },
    })
    .catch(() => undefined)
  await update($, composing, () => null)
  $.ui.toast(`Sent to ${agent.name}`)
}

/** Reads an agent's conversation into state; a draw only reads that, since this can be slow. */
async function loadTranscript($: $, agentId: string) {
  const messages = await $.session.messages({ agentId }).catch((error: unknown) => ({ deny: String(error) }))
  const steps = 'deny' in messages ? [] : stepsOf(messages)
  await update($, transcript, () => ({
    agentId,
    steps: steps.slice(-80),
    total: steps.length,
    deny: 'deny' in messages ? messages.deny : null,
  }))
}

async function openTranscript($: $, agentId: string) {
  await update($, viewing, () => agentId)
  await loadTranscript($, agentId)
}

export const register: Register = on => {
  // An Agent call's `isolation` reaches tool.call but not agent.spawn, which it starts.
  const worktreeCalls = new Set<string>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'board',
      description: 'Show the implement-spec ticket board',
    })
    $.clock.every(REFRESH_MS, () => {
      void read($, agents).then(all => {
        if (Object.values(all).some(agent => agent.run === 'running' || agent.run === 'waiting')) return refresh($)
      })
    })
    await refresh($)
    // A reload runs this again: a pane left open by the previous load is never asked to draw otherwise.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'board' }, async $ => {
    await update($, viewing, () => null)
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Tickets' })
    // Opening a pane that is already open changes nothing, so it is asked to draw again.
    $.ui.invalidate('ui.render')

    return { text: 'Ticket board opened.' }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Agent' && e.isolation === 'worktree') worktreeCalls.add(e.tool_use_id)

    const id = e.agentId
    if (id !== undefined && (await read($, agents))[id] !== undefined) {
      const activity = activityOf(e.tool, e as unknown as Record<string, unknown>)
      // A message or its own background work wakes an agent, so any call means it runs again.
      await setAgent($, id, agent => ({
        ...agent,
        run: 'running',
        endedAt: undefined,
        outcome: undefined,
        tools: agent.tools + 1,
        activity,
      }))
    }

    const result = await next(e)
    if (id !== undefined && (await read($, viewing)) === id) void loadTranscript($, id).catch(() => undefined)

    return result
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (e.workflow !== undefined || ran.deny !== undefined || ran.agentId === undefined) return ran

    const where = locate(e.prompt, e.name)
    if (where.feature === undefined) return ran

    const slug = where.feature
    const now = await $.clock.now()
    const agent: BoardAgent = {
      id: ran.agentId,
      name: e.name ?? e.description,
      feature: slug,
      ticket: where.ticket,
      role: where.role,
      run: 'running',
      isWorktree: worktreeCalls.delete(e.tool_use_id),
      startedAt: now,
      tools: 0,
    }
    const known = (await read($, features))[slug]
    const dir = known?.dir || (await featureDir($, e.prompt, slug))
    const tickets = (await loadTickets($, dir)) ?? known?.tickets ?? []
    await update($, agents, all => ({ ...all, [agent.id]: agent }))
    await update($, features, all => ({ ...all, [slug]: { slug, dir, tickets, seenAt: now } }))
    await update($, selected, () => slug)
    if (known === undefined) void $.ui.open({ id: PANE, title: 'Tickets' }).catch(() => undefined)
    await showStatus($)

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const agent = e.agentId === undefined ? undefined : (await read($, agents))[e.agentId]

    if (agent !== undefined) {
      const outcome: Outcome = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      // Waiting until the engine says the loop stopped: its own background work can resume it.
      await setAgent($, agent.id, one => ({
        ...one,
        run: 'waiting',
        outcome,
        activity: undefined,
        answer: e.answer.slice(0, 400),
      }))
      $.clock.after(SETTLE_MS, () => void refresh($))
      if ((await read($, viewing)) === agent.id) await loadTranscript($, agent.id)
    }
    // The orchestrator and the agents both resolve tickets by editing their files.
    if (e.agentId === undefined || agent !== undefined) await refresh($)

    return result
  })

  // A click on a card: its region posts the agent whose transcript to open.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { open?: unknown } | null
    if (e.requestId === PANE && typeof data?.open === 'string') {
      await openTranscript($, data.open)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    try {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // The table answers `in` for every tag, so the surface decides which ones draw.
    const Input = e.surface === 'mobile' ? undefined : 'Input' in elements ? elements.Input : undefined
    const Select = e.surface === 'mobile' ? undefined : 'Select' in elements ? elements.Select : undefined
    const Svg = e.surface === 'desktop' || e.surface === 'mobile' ? ('Svg' in elements ? elements.Svg : undefined) : undefined
    const now = await $.clock.now()
    const allFeatures = Object.values(await read($, features)).sort((a, b) => b.seenAt - a.seenAt)
    const feature = await current($)
    const composingFor = await read($, composing)
    const isShowingAllDone = await read($, showFinished)
    const viewingId = await read($, viewing)
    // The agent whose transcript the person opened from the tasks list; its card is marked.
    const inView = e.props.view.agentId

    if (feature === undefined) {
      return (
        <Box flexDirection="column" gap={1} paddingX={1}>
          <Text bold>Nothing to watch yet</Text>
          <Text dimColor>
            Agents show up here once their prompt points at a ticket in .scratch/&lt;feature&gt;/issues/. Start a run
            with /implement-spec.
          </Text>
        </Box>
      )
    }

    const own = Object.values(await read($, agents))
      .filter(agent => agent.feature === feature.slug)
      .sort((a, b) => a.startedAt - b.startedAt)
    const ofTicket = (ticket: TicketFile) =>
      own.filter(agent => agent.ticket !== undefined && sameNumber(agent.ticket, ticket.number))
    // Agent names carry the ticket key (`VI-9-02`); its prefix names every card the same way.
    const prefix = own.map(agent => /^(?!merge)(.+)-\d{2,3}$/i.exec(agent.name)?.[1]).find(Boolean)
    const keyOf = (number: string) => (prefix === undefined ? number : `${prefix}-${number}`)

    const cards = dependencyOrder(feature.tickets).map(ticket => {
      const mine = ofTicket(ticket)
      return { ticket, agent: mine.at(-1), ...ticketState(ticket, feature.tickets, mine) }
    })
    type Card = (typeof cards)[number]
    const columns = COLUMNS.map(column => ({
      ...column,
      cards: cards.filter(card => (column.tones as readonly Tone[]).includes(card.tone)),
    }))
    const helpers = own.filter(
      agent => agent.ticket === undefined && (agent.run === 'running' || agent.run === 'waiting' || agent.run === 'failed' || agent.run === 'stopped'),
    )
    const done = feature.tickets.filter(ticket => ticket.isDone).length
    // A desktop cell is about 13 px wide: five columns need some 60 of them, about 780 px.
    const isBoard = e.surface === 'desktop' && e.props.bodyColumns >= 60

    // The desktop skips an Svg with an empty alt, so each one names what it marks.
    const icon = (column: ColumnId, title: string) =>
      Svg !== undefined ? (
        <Svg source={columnIcon(column)} alt={title} width={14} height={14} />
      ) : (
        <Text color={COLOR[column === 'progress' ? 'running' : column]}>{TEXT_GLYPH[column]}</Text>
      )
    const dot = (tone: Tone) =>
      Svg !== undefined ? (
        <Svg source={agentDot(tone)} alt={tone} width={12} height={12} />
      ) : (
        <Text color={COLOR[tone]}>{TEXT_GLYPH[tone]}</Text>
      )

    const composer = (agent: BoardAgent) =>
      composingFor === agent.id &&
      Input !== undefined && (
        <Box key={`composer-${agent.id}`} flexDirection="column" gap={1}>
          <Input
            key={`compose-${agent.id}`}
            label={`Message ${agent.name}`}
            placeholder="It reads this between tool calls"
            submitLabel="Send"
            autoFocus
            onSubmit={text => sendMessage($, agent, text)}
          />
          <Button key={`cancel-${agent.id}`} label="Cancel" dimColor onPress={() => update($, composing, () => null)} />
        </Box>
      )
    const transcriptButton = (agent: BoardAgent) => (
      <Button
        key={`transcript-${agent.id}`}
        label="Transcript"
        dimColor
        // One write per press: a write redraws the pane, and a second write chained after it is lost.
        onPress={() => openTranscript($, agent.id)}
      />
    )
    const messageButton = (agent: BoardAgent) =>
      composingFor !== agent.id && (
        <Button key={`message-${agent.id}`} label="Message" dimColor onPress={() => update($, composing, () => agent.id)} />
      )

    const Client = e.surface === 'desktop' || e.surface === 'terminal' ? ('Client' in elements ? elements.Client : undefined) : undefined
    const seg = (text: string, style: Partial<Omit<Segment, 'text'>> = {}): Segment => ({
      text,
      color: style.color ?? null,
      isDim: style.isDim ?? false,
      isBold: style.isBold ?? false,
    })
    const line = (segments: Segment[], isWrapped = false): CardLine => ({ segments, isWrapped })

    /** What an agent is doing: its state, for how long, and the tool call it just made. */
    const agentStatus = (agent: BoardAgent, who: string, tone: Tone): CardLine[] => [
      line([
        seg(`${TEXT_GLYPH[tone]} ${who}${agent.run === 'waiting' ? 'Waiting' : 'Working'}  `, { color: COLOR[tone] }),
        seg(`${duration(agent.startedAt, now)}, ${agent.tools} tools${agent.isWorktree ? ', in a worktree' : ''}`, {
          isDim: true,
        }),
      ]),
      line([seg(agent.run === 'waiting' ? 'Waiting on background work' : (agent.activity ?? 'Starting up'), { isDim: true })]),
    ]

    /** A card's content as plain lines, the same whether a click region or the pane draws it. */
    const cardLines = (card: Card): CardLine[] => {
      const agent = card.agent
      const checks = card.ticket.checksTotal > 0 ? `   ${card.ticket.checksDone}/${card.ticket.checksTotal}` : ''
      const lines = [
        line([seg(keyOf(card.ticket.number), { isDim: true }), seg(checks, { isDim: true })]),
        line([seg(card.ticket.title, { isDim: card.tone === 'done' })], true),
      ]
      if (card.tone === 'blocked') {
        const blockers = openBlockers(card.ticket, feature.tickets).map(keyOf).join(', ')
        lines.push(line([seg(`Waits for ${blockers}`, { isDim: true })], true))
      }
      if (agent === undefined || card.tone === 'ready' || card.tone === 'blocked') return lines

      // The card's key already names the implementer; another agent (a merge) is named.
      const who = agent.name === keyOf(card.ticket.number) ? '' : `${agent.name} `
      if (card.tone === 'done') {
        lines.push(line([seg(`Took ${duration(agent.startedAt, agent.endedAt ?? now)}`, { isDim: true })]))
      } else if (card.tone === 'attention' || card.tone === 'failed') {
        const why =
          card.label === 'needs merge'
            ? `${who === '' ? 'Finished' : `${who}finished`}. Merge its work to close the ticket.`
            : card.label === 'merged, still open'
              ? `${who === '' ? 'Merged' : `${who}merged it`}, but the ticket still says open.`
              : `${who}${card.label === 'stopped' ? 'Stopped' : 'Failed'} before finishing.`
        lines.push(line([seg(why)], true))
      } else {
        lines.push(...agentStatus(agent, who, card.tone))
      }
      if (agent.id === inView) lines.push(line([seg('Open in the main view', { color: COLOR.running })]))
      return lines
    }

    /** The lines in a region a click opens the agent's transcript from, or drawn plain where none is. */
    const clickable = (key: string, agent: BoardAgent | undefined, lines: CardLine[]) =>
      Client !== undefined && agent !== undefined ? (
        <Client key={key} module="./card.tsx" props={{ agentId: agent.id, lines } satisfies CardProps} width="100%" />
      ) : (
        <Box key={key} flexDirection="column">
          {lines.map((one, index) => (
            <Text key={`${key}-line-${index}`} wrap={one.isWrapped ? 'wrap' : 'truncate-end'}>
              {one.segments.map((part, at) => (
                <Text
                  key={`${key}-segment-${index}-${at}`}
                  color={part.color ?? undefined}
                  dimColor={part.isDim}
                  bold={part.isBold}
                >
                  {part.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      )

    const cardView = (card: Card) => {
      const agent = card.agent
      const canMessage =
        agent !== undefined && ['running', 'waiting', 'attention', 'failed'].includes(card.tone)
      // Without a click region the transcript needs a button of its own.
      const needsButton = agent !== undefined && Client === undefined
      return (
        <Box
          key={`card-${card.ticket.number}`}
          flexDirection="column"
          borderStyle="round"
          borderDimColor
          borderColor={
            agent !== undefined && agent.id === inView
              ? COLOR.running
              : card.tone === 'attention' || card.tone === 'failed'
                ? COLOR[card.tone]
                : undefined
          }
          hover={agent !== undefined ? { borderColor: COLOR.running, borderDimColor: false } : undefined}
          paddingX={1}
        >
          {clickable(`open-${agent?.id ?? card.ticket.number}`, agent, cardLines(card))}
          {(canMessage || needsButton) && (
            <Box flexDirection="row" gap={1}>
              {needsButton && transcriptButton(agent!)}
              {canMessage && messageButton(agent!)}
            </Box>
          )}
          {canMessage && composer(agent!)}
        </Box>
      )
    }

    const columnView = (column: (typeof columns)[number]) => {
      const isDone = column.id === 'done'
      const shown = isDone && !isShowingAllDone ? column.cards.slice(-3) : column.cards
      const hidden = column.cards.length - shown.length
      return (
        <Box
          key={`column-${column.id}`}
          flexDirection="column"
          gap={1}
          width={isBoard ? '20%' : undefined}
          flexShrink={1}
        >
          <Box flexDirection="row" alignItems="center" gap={1}>
            {icon(column.id, column.title)}
            <Text bold>{column.title}</Text>
            <Text dimColor>{column.cards.length}</Text>
          </Box>
          {shown.map(cardView)}
          {isDone && (hidden > 0 || isShowingAllDone) && column.cards.length > 3 && (
            <Button
              key="toggle-done"
              label={isShowingAllDone ? 'Show fewer' : `Show ${hidden} more`}
              dimColor
              onPress={() => update($, showFinished, shown => !shown)}
            />
          )}
        </Box>
      )
    }

    const viewed = own.find(agent => agent.id === viewingId)
    if (viewed !== undefined) {
      const Markdown = 'Markdown' in elements ? elements.Markdown : undefined
      const ticket = feature.tickets.find(t => viewed.ticket !== undefined && sameNumber(t.number, viewed.ticket))
      const loaded = await read($, transcript)
      const view = loaded?.agentId === viewed.id ? loaded : null
      const shown = view?.steps ?? []
      const hiddenSteps = (view?.total ?? 0) - shown.length
      const tone: Tone =
        viewed.run === 'running' ? 'running' : viewed.run === 'waiting' ? 'waiting' : viewed.run === 'done' ? 'done' : 'failed'
      const state =
        viewed.run === 'running' || viewed.run === 'waiting'
          ? `${viewed.run === 'waiting' ? 'Waiting' : 'Working'}, ${duration(viewed.startedAt, now)}, ${viewed.tools} tools`
          : `${viewed.run === 'done' ? 'Finished' : viewed.run === 'failed' ? 'Failed' : 'Stopped'} after ${duration(viewed.startedAt, viewed.endedAt ?? now)}, ${viewed.tools} tools`
      const prose = (key: string, text: string, isDim = false) =>
        Markdown !== undefined ? (
          <Markdown key={key} text={text} dimColor={isDim} />
        ) : (
          <Text key={key} wrap="wrap" dimColor={isDim}>
            {text}
          </Text>
        )

      return (
        <Box flexDirection="column" gap={1} paddingX={1}>
          <Box flexDirection="row" alignItems="center" gap={2}>
            <Button key="back" label="Back to board" dimColor onPress={() => update($, viewing, () => null)} />
            {(viewed.run === 'running' || viewed.run === 'waiting' || viewed.run === 'failed' || viewed.run === 'stopped') &&
              messageButton(viewed)}
          </Box>
          {composer(viewed)}
          <Box flexDirection="column">
            <Text dimColor>{ticket === undefined ? 'Whole spec' : keyOf(ticket.number)}</Text>
            <Text bold wrap="wrap">
              {ticket?.title ?? viewed.name}
            </Text>
            <Box flexDirection="row" alignItems="center" gap={1}>
              {dot(tone)}
              <Text color={COLOR[tone]}>{viewed.name}</Text>
              <Text dimColor>{state}</Text>
            </Box>
          </Box>
          {view === null ? (
            <Text dimColor>Loading the transcript…</Text>
          ) : view.deny !== null ? (
            <Text dimColor wrap="wrap">
              Its transcript can't be read here: {view.deny}
            </Text>
          ) : (
            <Box flexDirection="column" gap={1}>
              {hiddenSteps > 0 && <Text dimColor>{hiddenSteps} earlier steps are not shown.</Text>}
              {shown.map((step, index) => {
                const key = `step-${hiddenSteps + index}`
                switch (step.kind) {
                  case 'task':
                    return (
                      <Box key={key} flexDirection="column">
                        <Text bold>Task</Text>
                        {prose(`${key}-text`, step.text.length > 1200 ? `${step.text.slice(0, 1200)}…` : step.text, true)}
                      </Box>
                    )
                  case 'message':
                    return (
                      <Box key={key} flexDirection="column">
                        <Text bold color={COLOR.attention}>
                          Message
                        </Text>
                        {prose(`${key}-text`, step.text)}
                      </Box>
                    )
                  case 'say':
                    return prose(key, step.text)
                  case 'tool':
                    return (
                      <Box key={key} flexDirection="column">
                        <Text color={step.isError ? COLOR.failed : COLOR.muted} wrap="truncate-end">
                          {step.line}
                        </Text>
                        {step.result !== null && (
                          <Text dimColor wrap="truncate-end">
                            {'  '}
                            {step.result}
                          </Text>
                        )}
                      </Box>
                    )
                }
              })}
              {shown.length === 0 && <Text dimColor>Nothing yet.</Text>}
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
          <Text bold>{feature.slug}</Text>
          {allFeatures.length > 1 && Select !== undefined ? (
            <Select
              key="feature"
              label="Spec"
              value={feature.slug}
              options={allFeatures.map(one => ({ value: one.slug, label: one.slug }))}
              onSelect={slug => update($, selected, () => slug).then(() => showStatus($))}
            />
          ) : (
            <Text dimColor>
              {done} of {feature.tickets.length} done
            </Text>
          )}
        </Box>

        <Box flexDirection={isBoard ? 'row' : 'column'} gap={isBoard ? 2 : 1} alignItems="flex-start">
          {columns.filter(column => isBoard || column.cards.length > 0).map(columnView)}
        </Box>

        {helpers.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Text bold>Working on the whole spec</Text>
            {helpers.map(agent => {
              const tone: Tone = agent.run === 'running' ? 'running' : agent.run === 'waiting' ? 'waiting' : 'failed'
              const lines =
                agent.run === 'running' || agent.run === 'waiting'
                  ? agentStatus(agent, `${agent.name} `, tone)
                  : [line([seg(`${TEXT_GLYPH[tone]} ${agent.name} ${agent.run} after ${duration(agent.startedAt, agent.endedAt ?? now)}`, { color: COLOR[tone] })])]
              return (
                <Box key={`helper-${agent.id}`} flexDirection="column">
                  {clickable(`open-${agent.id}`, agent, lines)}
                  <Box flexDirection="row" gap={1}>
                    {Client === undefined && transcriptButton(agent)}
                    {messageButton(agent)}
                  </Box>
                  {composer(agent)}
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
    } catch (error) {
      // A failed draw leaves the pane blank and stuck in its view; this one says why and offers a way out.
      const { Box, Button, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" gap={1} paddingX={1}>
          <Text bold>The board couldn't draw this view</Text>
          <Text dimColor wrap="wrap">
            {error instanceof Error ? error.message : String(error)}
          </Text>
          <Button key="recover" label="Back to board" onPress={() => update($, viewing, () => null)} />
        </Box>
      )
    }
  })
}
