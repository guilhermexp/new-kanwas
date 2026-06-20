import type { NativeGenerateResult } from '../llm.js'
import type { ResolvedProductAgentFlow } from '../flow.js'
import type { TraceContext, TraceIdentity } from '../tracing/trace_context.js'

/**
 * Shared interface for execution engine bridges.
 *
 * Each engine must accept the same inputs that the current Vercel AI path
 * uses inside `generateActionAndObservation()` and return a compatible
 * `NativeGenerateResult`.
 */
export interface ExecutionBridgeInput {
  flow: ResolvedProductAgentFlow
  abortSignal: AbortSignal | undefined
  traceContext: TraceContext
  traceIdentity: TraceIdentity
  traceProperties?: Record<string, unknown>
}

/**
 * The result type returned by any execution engine bridge.
 * Matches `NativeGenerateResult` from llm.ts.
 */
export type ExecutionBridgeResult = NativeGenerateResult
