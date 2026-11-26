
export interface SoulStarterTool {
  kind: 'builtin' | 'mcp'
  name: string
  service?: string
}

export interface SoulStarter {
  prompt: string
  tools: SoulStarterTool[]
}

export interface SoulDesign {
  intro: string
  welcome: string
  starters: SoulStarter[]
  mission: string
  capability_tags: string[]
  forbidden: string[]
  prompt_extra: string
  next_action_hints: boolean
  next_action_hints_count: number
  intent_focus: boolean
  intent_focus_depth: number
  input_rewrite: boolean
  term_normalize: boolean
  task_planning: boolean
}
