/** One question of a round: its number as the reply wrote it (`2` for **Q2**) and its title. */
export type GrillQuestion = { number: string; title: string }

/** The round the main loop's last answer asked, until any prompt answers it. */
export type GrillRound = {
  /** The answer, whitespace collapsed: the reply block the round is drawn in is its last. */
  answer: string
  questions: GrillQuestion[]
  /** The questions whose recommendation was clicked into the prompt box, by number. */
  accepted: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'grill-answers': { round: GrillRound | null }
  }
}
