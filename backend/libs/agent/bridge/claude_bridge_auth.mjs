/**
 * Pure helpers for the Claude Agent SDK bridge.
 *
 * Extracted from claude_bridge.mjs so the auth-sanitization and error-mapping
 * logic can be unit-tested without spawning the SDK subprocess.
 *
 * The claude-sdk engine authenticates through the Claude Code subscription (the
 * logged-in CLI credentials), NOT an API key. A stray ANTHROPIC_API_KEY /
 * ANTHROPIC_AUTH_TOKEN in the environment would override that and force
 * (often invalid) API-key auth, so they are stripped before the SDK runs.
 */

/** Env var names that must never reach the SDK so it falls back to the subscription login. */
export const STRIPPED_AUTH_ENV_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']

/**
 * Build the environment passed to the Claude Agent SDK query.
 * Strips API-key auth vars so the SDK uses the Claude Code subscription, and
 * tags the client app. Does not mutate the input.
 *
 * IS_SANDBOX=1 marks this as a controlled automation context. Claude Code
 * refuses `--dangerously-skip-permissions` (used by the bridge's bypass mode)
 * when running as root unless this is set — required when the backend runs as
 * root inside a container. Harmless when running as a normal host user.
 *
 * @param {Record<string, string | undefined>} sourceEnv
 * @returns {Record<string, string | undefined>}
 */
export function sanitizeBridgeEnv(sourceEnv) {
  const env = { ...sourceEnv, CLAUDE_AGENT_SDK_CLIENT_APP: 'kanwas/1.0', IS_SANDBOX: '1' }
  for (const key of STRIPPED_AUTH_ENV_VARS) {
    delete env[key]
  }
  return env
}

/**
 * Resolve the human-readable error message from an SDK `result` message that
 * has `is_error: true`.
 *
 * The SDK frequently reports `subtype: 'success'` with the real reason in
 * `result` (e.g. "Invalid API key", "model not found"), so prefer, in order:
 * explicit `errors[]`, then `result`, then `subtype`, then a generic fallback.
 *
 * @param {{ errors?: unknown, result?: unknown, subtype?: unknown }} message
 * @returns {string}
 */
export function resolveSdkErrorMessage(message) {
  const errors = Array.isArray(message?.errors) ? message.errors.join('\n') : ''
  const detail = typeof message?.result === 'string' ? message.result : ''
  const subtype = typeof message?.subtype === 'string' ? message.subtype : ''
  return errors || detail || subtype || 'Claude Agent SDK query failed.'
}
