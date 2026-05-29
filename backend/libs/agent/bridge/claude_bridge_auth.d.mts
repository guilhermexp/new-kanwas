/** Type declarations for the plain-JS bridge auth helpers (claude_bridge_auth.mjs). */

export declare const STRIPPED_AUTH_ENV_VARS: string[]

export declare function sanitizeBridgeEnv(
  sourceEnv: Record<string, string | undefined>
): Record<string, string | undefined>

export declare function resolveSdkErrorMessage(message: {
  errors?: unknown
  result?: unknown
  subtype?: unknown
}): string
