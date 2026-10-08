import type { ClientModule } from 'claude-code'

/** One run of text on a card line: plain data, since a surface module takes JSON props. */
export type Segment = { text: string; color: string | null; isDim: boolean; isBold: boolean }

export type CardLine = { segments: Segment[]; isWrapped: boolean }

export type CardProps = {
  /** The agent a click opens; null for a card no agent has worked on. */
  agentId: string | null
  lines: CardLine[]
}

/**
 * A card's content, drawn in a region of its own so a click anywhere on it opens
 * its agent's transcript: the press goes to the hooks module as a post.
 */
const Card: ClientModule<CardProps> = (props, surface) => {
  const { Box, Text } = surface.elements

  surface.onPointer(event => {
    if (event.type !== 'up' || event.button === 'right' || props.agentId === null) return
    // After a press the region keeps the pointer: a release outside it is a drag away.
    const isInside = event.x >= 0 && event.y >= 0 && event.x < surface.columns && event.y < surface.rows
    if (isInside) surface.post({ open: props.agentId })
  })

  return (
    <Box flexDirection="column">
      {props.lines.map((line, index) => (
        <Text key={`line-${index}`} wrap={line.isWrapped ? 'wrap' : 'truncate-end'}>
          {line.segments.map((segment, at) => (
            <Text
              key={`segment-${index}-${at}`}
              color={segment.color ?? undefined}
              dimColor={segment.isDim}
              bold={segment.isBold}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

export default Card
