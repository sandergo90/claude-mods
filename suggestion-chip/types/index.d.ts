/** The prompt last proposed as the box's dim suggestion, until any prompt is submitted. */
export type Suggestion = string | null

declare module 'claude-code' {
  interface PluginState {
    'suggestion-chip': { suggestion: Suggestion }
  }
}
