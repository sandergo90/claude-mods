import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register } from 'claude-code'

import type { BoardAgent, Feature, TicketFile } from '../types'
import { agentDot, type ColumnId, COLOR, COLUMNS, columnIcon, dependencyOrder, TEXT_GLYPH } from './glyphs'
import { activityOf, duration, locate, openBlockers, parseTicket, sameNumber, ticketState, type Tone } from './tickets'

const PANE = 'ticket-board'
const REFRESH_MS = 15_000
const SETTLE_MS = 3_000

const features = atom({ plugin: 'ticket-board', key: 'features' } as const, {})
const agents = atom({ plugin: 'ticket-board', key: 'agents' } as const, {})
const composing = atom({ plugin: 'ticket-board', key: 'composing' } as const, null)
const selected = atom({ plugin: 'ticket-board', key: 'selected' } as const, null)
const showFinished = atom({ plugin: 'ticket-board', key: 'showFinished' } as const, false)

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

    return next(e)
  })

  on('command.run', { command: 'board' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Tickets' })

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

    return next(e)
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
    }
    // The orchestrator and the agents both resolve tickets by editing their files.
    if (e.agentId === undefined || agent !== undefined) await refresh($)

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
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
    const messageButton = (agent: BoardAgent) =>
      composingFor !== agent.id && (
        <Button key={`message-${agent.id}`} label="Message" dimColor onPress={() => update($, composing, () => agent.id)} />
      )

    /** What the card says about its agent: its state, for how long, and what it is doing right now. */
    const agentLines = (card: Card) => {
      const agent = card.agent
      if (agent === undefined || card.tone === 'ready' || card.tone === 'blocked') return []
      // The card's key already names the implementer; another agent (a merge) is named.
      const who = agent.name === keyOf(card.ticket.number) ? '' : `${agent.name} `
      const where = agent.isWorktree ? ', in a worktree' : ''
      if (card.tone === 'done') {
        return [<Text dimColor>Took {duration(agent.startedAt, agent.endedAt ?? now)}</Text>]
      }
      if (card.tone === 'attention' || card.tone === 'failed') {
        const why =
          card.label === 'needs merge'
            ? `${who === '' ? 'Finished' : `${who}finished`}. Merge its work to close the ticket.`
            : card.label === 'merged, still open'
              ? `${who === '' ? 'Merged' : `${who}merged it`}, but the ticket still says open.`
              : `${who === '' ? '' : who}${card.label === 'stopped' ? 'Stopped' : 'Failed'} before finishing.`
        return [<Text wrap="wrap">{why}</Text>]
      }
      const state = agent.run === 'waiting' ? 'Waiting' : 'Working'
      return [
        <Box flexDirection="row" alignItems="center" gap={1}>
          {dot(card.tone)}
          <Text color={COLOR[card.tone]} wrap="truncate-end">
            {who}
            {state}
          </Text>
          <Text dimColor wrap="truncate-end">
            {duration(agent.startedAt, now)}, {agent.tools} tools{where}
          </Text>
        </Box>,
        <Text dimColor wrap="truncate-end">
          {agent.run === 'waiting' ? 'Waiting on background work' : (agent.activity ?? 'Starting up')}
        </Text>,
      ]
    }

    const cardView = (card: Card) => {
      const agent = card.agent
      const canMessage =
        agent !== undefined && ['running', 'waiting', 'attention', 'failed'].includes(card.tone)
      const blockers = openBlockers(card.ticket, feature.tickets)
      return (
        <Box
          key={`card-${card.ticket.number}`}
          flexDirection="column"
          borderStyle="round"
          borderDimColor
          borderColor={card.tone === 'attention' || card.tone === 'failed' ? COLOR[card.tone] : undefined}
          paddingX={1}
        >
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text dimColor>{keyOf(card.ticket.number)}</Text>
            {card.ticket.checksTotal > 0 && (
              <Text dimColor>
                {card.ticket.checksDone}/{card.ticket.checksTotal}
              </Text>
            )}
          </Box>
          <Text wrap="wrap" dimColor={card.tone === 'done'}>
            {card.ticket.title}
          </Text>
          {card.tone === 'blocked' && (
            <Text dimColor wrap="wrap">
              Waits for {blockers.map(keyOf).join(', ')}
            </Text>
          )}
          {...agentLines(card)}
          {canMessage && messageButton(agent!)}
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
              return (
                <Box key={`helper-${agent.id}`} flexDirection="column">
                  <Box flexDirection="row" alignItems="center" gap={1}>
                    {dot(tone)}
                    <Text color={COLOR[tone]}>{agent.name}</Text>
                    <Text dimColor wrap="truncate-end">
                      {agent.run === 'failed' || agent.run === 'stopped'
                        ? `${agent.run} after ${duration(agent.startedAt, agent.endedAt ?? now)}`
                        : `${duration(agent.startedAt, now)}, ${agent.tools} tools`}
                    </Text>
                  </Box>
                  {(agent.run === 'running' || agent.run === 'waiting') && (
                    <Text dimColor wrap="truncate-end">
                      {agent.run === 'waiting' ? 'Waiting on background work' : (agent.activity ?? 'Starting up')}
                    </Text>
                  )}
                  {messageButton(agent)}
                  {composer(agent)}
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })
}
