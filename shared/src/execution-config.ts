/**
 * Execution engine abstraction.
 *
 * Allows the agent to dispatch between different execution backends:
 * - vercel-ai: default Vercel AI SDK tool loop
 * - claude-sdk: Claude Agent SDK bridge
 * - codex: Codex app-server bridge
 */

export type ExecutionEngine = 'vercel-ai' | 'claude-sdk' | 'codex'

export const DEFAULT_EXECUTION_ENGINE: ExecutionEngine = 'vercel-ai'

const VALID_ENGINES: ReadonlySet<string> = new Set<ExecutionEngine>(['vercel-ai', 'claude-sdk', 'codex'])

export function isExecutionEngine(value: string): value is ExecutionEngine {
  return VALID_ENGINES.has(value)
}

/**
 * Resolve the execution engine from `process.env.EXECUTION_ENGINE`.
 * Falls back to `DEFAULT_EXECUTION_ENGINE` when the env var is missing or invalid.
 */
export function resolveExecutionEngine(): ExecutionEngine {
  const raw = typeof process !== 'undefined' ? process.env.EXECUTION_ENGINE?.trim() : undefined

  if (raw && isExecutionEngine(raw)) {
    return raw
  }

  return DEFAULT_EXECUTION_ENGINE
}

/**
 * User-selectable agent presets shown in settings. Each maps to an execution
 * engine and (optionally) a model the engine should use. `model: null` lets the
 * engine use its own default (e.g. CODEX_MODEL / Codex CLI default).
 */
export interface ExecutionEnginePreset {
  id: ExecutionEngine
  label: string
  description: string
  model: string | null
}

export const EXECUTION_ENGINE_PRESETS: readonly ExecutionEnginePreset[] = [
  {
    id: 'codex',
    label: 'Codex',
    description: 'OpenAI Codex CLI (GPT-5.5)',
    model: null,
  },
  {
    id: 'claude-sdk',
    label: 'Claude Code',
    description: 'Anthropic Claude Code (Opus 4.8)',
    model: 'claude-opus-4-8',
  },
  {
    id: 'vercel-ai',
    label: 'Built-in (API key)',
    description: 'In-process Vercel AI SDK loop',
    model: null,
  },
]

export function getExecutionEnginePreset(engine: string | null | undefined): ExecutionEnginePreset | undefined {
  if (!engine) return undefined
  return EXECUTION_ENGINE_PRESETS.find((preset) => preset.id === engine)
}
