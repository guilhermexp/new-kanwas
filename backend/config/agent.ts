import env from '#start/env'
import { resolveExecutionEngine } from 'shared/execution-config'

export default {
  anthropicApiKey: env.get('ANTHROPIC_API_KEY'),
  openaiApiKey: env.get('OPENAI_API_KEY'),
  openaiBaseUrl: env.get('OPENAI_BASE_URL'),
  parallelApiKey: env.get('PARALLEL_API_KEY'),
  assemblyaiApiKey: env.get('ASSEMBLYAI_API_KEY'),
  executionEngine: resolveExecutionEngine(),
  connectedExternalTools: {
    enabled: true,
  },
  // Codex engine configuration
  codex: {
    /** Path to codex CLI executable (default: 'codex', assumes on PATH) */
    executable: env.get('CODEX_EXECUTABLE', 'codex'),
    /** Optional model override for Codex sessions; unset uses Codex CLI defaults. */
    model: env.get('CODEX_MODEL'),
  },
}
