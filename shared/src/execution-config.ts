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
