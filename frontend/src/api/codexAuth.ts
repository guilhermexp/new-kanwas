import { tuyau } from './client'

export interface CodexAuthStatus {
  connected: boolean
  lastRefresh?: string
}

export interface CodexAuthStartResult {
  sessionId: string
  userCode: string
  verificationUri: string
  intervalSeconds: number
  expiresAt: string
}

export type CodexAuthPollResult = { status: 'pending' } | { status: 'connected' }

export async function getCodexAuthStatus(): Promise<CodexAuthStatus> {
  const response = await tuyau['codex-auth'].status.$get()
  if (response.error) throw response.error
  return response.data as CodexAuthStatus
}

export async function startCodexAuth(): Promise<CodexAuthStartResult> {
  const response = await tuyau['codex-auth'].start.$post()
  if (response.error) throw response.error
  return response.data as CodexAuthStartResult
}

export async function pollCodexAuth(sessionId: string): Promise<CodexAuthPollResult> {
  const response = await tuyau['codex-auth']({ sessionId }).$get()
  if (response.error) throw response.error
  return response.data as CodexAuthPollResult
}

export async function disconnectCodexAuth(): Promise<CodexAuthStatus> {
  const response = await tuyau['codex-auth'].$delete()
  if (response.error) throw response.error
  return response.data as CodexAuthStatus
}
