import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { codexHomeBase, resolveUserCodexHome } from '#services/codex_home'

const OPENAI_ISSUER = 'https://auth.openai.com'
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_OAUTH_TOKEN_URL = `${OPENAI_ISSUER}/oauth/token`
const CODEX_VERIFICATION_URI = `${OPENAI_ISSUER}/codex/device`
const DEFAULT_EXPIRES_IN_SECONDS = 15 * 60
const SLOW_DOWN_INTERVAL_INCREMENT_SECONDS = 5
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'

export interface CodexOauthServiceOptions {
  /** Base directory under which each user's `<userId>/auth.json` is stored. */
  codexHomeBase?: string
  fetch?: typeof fetch
  sessionIdFactory?: () => string
  now?: () => Date
}

export interface CodexDeviceLoginStartResult {
  sessionId: string
  userCode: string
  verificationUri: string
  intervalSeconds: number
  expiresAt: string
}

export type CodexDeviceLoginPollResult = { status: 'pending'; intervalSeconds?: number } | { status: 'connected' }

export interface CodexOauthStatus {
  connected: boolean
  lastRefresh?: string
}

interface PendingDeviceSession {
  userId: string
  userCode: string
  deviceAuthId: string
  expiresAtMs: number
  intervalSeconds: number
}

interface DeviceUserCodeResponse {
  user_code?: string
  device_auth_id?: string
  interval?: number | string
  expires_in?: number | string
  expires_at?: number | string
}

interface DeviceTokenResponse {
  authorization_code?: string
  code_verifier?: string
}

type TokenResponse = Record<string, unknown> & {
  access_token?: string
  refresh_token?: string
  id_token?: string
  account_id?: string
  expires_in?: number | string
  expires_at?: number | string
}

interface CodexAuthPayload {
  auth_mode?: string
  OPENAI_API_KEY?: string | null
  tokens?: TokenResponse
  last_refresh?: string
}

// Keyed by `<userId>::<sessionId>` so a session started by one user can never
// be polled or observed by another.
const pendingSessions = new Map<string, PendingDeviceSession>()

// Best-effort in-process refresh/write serialization. The atomic rename below
// protects readers from truncated files; this queue prevents two requests in
// this backend process from racing to refresh and overwrite the same user's
// credential with stale data.
const authWriteLocks = new Map<string, Promise<void>>()

export default class CodexOauthService {
  private readonly codexHomeBase: string
  private readonly fetchImpl: typeof fetch
  private readonly sessionIdFactory: () => string
  private readonly now: () => Date

  constructor(options: CodexOauthServiceOptions = {}) {
    this.codexHomeBase = options.codexHomeBase || codexHomeBase()
    this.fetchImpl = options.fetch || fetch
    this.sessionIdFactory = options.sessionIdFactory || randomUUID
    this.now = options.now || (() => new Date())
  }

  async getStatus(userId: string): Promise<CodexOauthStatus> {
    const payload = this.readCodexAuth(userId)
    const tokens = payload?.tokens
    if (!tokens?.access_token) {
      return { connected: false }
    }

    if (!this.isTokenExpired(tokens)) {
      return { connected: true, lastRefresh: payload?.last_refresh }
    }

    if (!tokens.refresh_token) {
      return { connected: false }
    }

    try {
      const refreshed = await this.withUserAuthLock(userId, async () => {
        const latest = this.readCodexAuth(userId)
        const latestTokens = latest?.tokens
        if (!latestTokens?.access_token) {
          return null
        }
        if (!this.isTokenExpired(latestTokens)) {
          return latest
        }
        if (!latestTokens.refresh_token) {
          return null
        }

        const refreshedTokens = await this.refreshAccessToken(latestTokens.refresh_token)
        return this.writeCodexAuth(userId, refreshedTokens, latestTokens)
      })

      return refreshed?.tokens?.access_token
        ? { connected: true, lastRefresh: refreshed.last_refresh }
        : { connected: false }
    } catch {
      return { connected: false }
    }
  }

  async startDeviceLogin(userId: string): Promise<CodexDeviceLoginStartResult> {
    const response = await this.fetchJson<DeviceUserCodeResponse>(`${OPENAI_ISSUER}/api/accounts/deviceauth/usercode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
    })

    if (!response.user_code || !response.device_auth_id) {
      throw new Error('OpenAI device-code response is missing user_code or device_auth_id')
    }

    const sessionId = this.sessionIdFactory()
    const intervalSeconds = Math.max(3, Number(response.interval ?? 5) || 5)
    const expiresAtMs = this.resolveDeviceExpiresAtMs(response)

    pendingSessions.set(this.sessionKey(userId, sessionId), {
      userId,
      userCode: response.user_code,
      deviceAuthId: response.device_auth_id,
      expiresAtMs,
      intervalSeconds,
    })

    return {
      sessionId,
      userCode: response.user_code,
      verificationUri: CODEX_VERIFICATION_URI,
      intervalSeconds,
      expiresAt: new Date(expiresAtMs).toISOString(),
    }
  }

  async pollDeviceLogin(userId: string, sessionId: string): Promise<CodexDeviceLoginPollResult> {
    const sessionKey = this.sessionKey(userId, sessionId)
    const session = pendingSessions.get(sessionKey)
    if (!session) {
      throw new Error('Codex device login session expired or does not exist')
    }

    if (this.now().getTime() > session.expiresAtMs) {
      pendingSessions.delete(sessionKey)
      throw new Error('Codex device login session expired')
    }

    const pollResponse = await this.fetchImpl(`${OPENAI_ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_auth_id: session.deviceAuthId, user_code: session.userCode }),
    })

    if (pollResponse.ok) {
      const deviceToken = (await pollResponse.json()) as DeviceTokenResponse
      if (!deviceToken.authorization_code || !deviceToken.code_verifier) {
        throw new Error('OpenAI device auth response is missing authorization_code or code_verifier')
      }

      const tokens = await this.exchangeAuthorizationCode(deviceToken.authorization_code, deviceToken.code_verifier)
      await this.withUserAuthLock(userId, async () => this.writeCodexAuth(userId, tokens))
      pendingSessions.delete(sessionKey)

      return { status: 'connected' }
    }

    const errorCode = await this.readOAuthErrorCode(pollResponse)
    if (
      pollResponse.status === 403 ||
      pollResponse.status === 404 ||
      errorCode === 'authorization_pending' ||
      errorCode === 'deviceauth_authorization_pending'
    ) {
      return { status: 'pending' }
    }

    if (errorCode === 'slow_down') {
      session.intervalSeconds += SLOW_DOWN_INTERVAL_INCREMENT_SECONDS
      pendingSessions.set(sessionKey, session)
      return { status: 'pending', intervalSeconds: session.intervalSeconds }
    }

    throw new Error(`OpenAI device auth polling failed with status ${pollResponse.status}`)
  }

  async disconnect(userId: string): Promise<CodexOauthStatus> {
    const authPath = this.authPath(userId)
    if (existsSync(authPath)) {
      rmSync(authPath, { force: true })
    }
    return { connected: false }
  }

  private async exchangeAuthorizationCode(authorizationCode: string, codeVerifier: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: `${OPENAI_ISSUER}/deviceauth/callback`,
      client_id: CODEX_OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
    })

    return this.fetchTokens(body, 'exchange')
  }

  private async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CODEX_OAUTH_CLIENT_ID,
    })

    return this.fetchTokens(body, 'refresh')
  }

  private async fetchTokens(body: URLSearchParams, operation: 'exchange' | 'refresh'): Promise<TokenResponse> {
    const tokens = await this.fetchJson<TokenResponse>(CODEX_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    const expiresIn = Number(tokens.expires_in)
    if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(expiresIn)) {
      throw new Error(`OpenAI token ${operation} response is missing access_token, refresh_token, or expires_in`)
    }

    return tokens
  }

  private writeCodexAuth(userId: string, tokens: TokenResponse, previousTokens: TokenResponse = {}): CodexAuthPayload {
    const userHome = this.userHome(userId)
    mkdirSync(userHome, { recursive: true, mode: 0o700 })
    chmodSync(userHome, 0o700)

    const mergedTokens = this.normalizeTokens(tokens, previousTokens)
    const payload: CodexAuthPayload = {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: mergedTokens,
      last_refresh: this.now().toISOString(),
    }

    // Write to a temp file then atomically rename over the destination, so a
    // crash mid-write can never leave auth.json missing or truncated.
    const authPath = this.authPath(userId)
    const tempPath = `${authPath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
    chmodSync(tempPath, 0o600)
    renameSync(tempPath, authPath)
    chmodSync(authPath, 0o600)

    return payload
  }

  private normalizeTokens(tokens: TokenResponse, previousTokens: TokenResponse): TokenResponse {
    const accessToken = tokens.access_token || previousTokens.access_token
    if (!accessToken) {
      throw new Error('OpenAI token response did not include an access_token')
    }

    const accountId = tokens.account_id || this.extractAccountId(accessToken) || previousTokens.account_id
    if (!accountId) {
      throw new Error('Failed to extract accountId from OpenAI Codex access token')
    }

    const expiresAt = this.resolveTokenExpiresAtMs(tokens) ?? this.resolveTokenExpiresAtMs(previousTokens)

    const merged: TokenResponse = {
      ...previousTokens,
      ...tokens,
      access_token: accessToken,
      account_id: accountId,
    }

    if (expiresAt !== undefined) {
      merged.expires_at = expiresAt
    }

    return merged
  }

  private readCodexAuth(userId: string): CodexAuthPayload | null {
    const authPath = this.authPath(userId)
    if (!existsSync(authPath)) {
      return null
    }

    try {
      return JSON.parse(readFileSync(authPath, 'utf8')) as CodexAuthPayload
    } catch {
      return null
    }
  }

  private isTokenExpired(tokens: TokenResponse): boolean {
    const expiresAt = this.resolveTokenExpiresAtMs(tokens)
    if (expiresAt === undefined) {
      return false
    }
    return this.now().getTime() >= expiresAt
  }

  private resolveDeviceExpiresAtMs(response: DeviceUserCodeResponse): number {
    const explicitExpiresAt = this.parseAbsoluteTimeMs(response.expires_at)
    if (explicitExpiresAt !== undefined) {
      return explicitExpiresAt
    }

    const expiresInSeconds = Math.max(
      60,
      Number(response.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS) || DEFAULT_EXPIRES_IN_SECONDS
    )
    return this.now().getTime() + expiresInSeconds * 1000
  }

  private resolveTokenExpiresAtMs(tokens: TokenResponse): number | undefined {
    const absolute = this.parseAbsoluteTimeMs(tokens.expires_at)
    if (absolute !== undefined) {
      return absolute
    }

    const expiresIn = Number(tokens.expires_in)
    if (Number.isFinite(expiresIn) && expiresIn > 0) {
      return this.now().getTime() + expiresIn * 1000
    }

    return undefined
  }

  private parseAbsoluteTimeMs(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }

    if (typeof value !== 'string' || !value.trim()) {
      return undefined
    }

    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric
    }

    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  private extractAccountId(accessToken: string): string | undefined {
    try {
      const [, payload] = accessToken.split('.')
      if (!payload) return undefined
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
      const auth = parsed[JWT_CLAIM_PATH] as Record<string, unknown> | undefined
      const accountId = auth?.chatgpt_account_id
      return typeof accountId === 'string' && accountId.length > 0 ? accountId : undefined
    } catch {
      return undefined
    }
  }

  private async readOAuthErrorCode(response: Response): Promise<string | undefined> {
    const text = await response.text().catch(() => '')
    if (!text) return undefined

    try {
      const json = JSON.parse(text) as { error?: string | { code?: string } }
      if (typeof json.error === 'string') return json.error
      if (typeof json.error?.code === 'string') return json.error.code
    } catch {
      // Ignore malformed error payloads; caller will fall back to status.
    }

    return undefined
  }

  private async withUserAuthLock<T>(userId: string, fn: () => Promise<T> | T): Promise<T> {
    const previous = authWriteLocks.get(userId) || Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    authWriteLocks.set(userId, queued)

    await previous
    try {
      return await fn()
    } finally {
      release()
      if (authWriteLocks.get(userId) === queued) {
        authWriteLocks.delete(userId)
      }
    }
  }

  private sessionKey(userId: string, sessionId: string): string {
    return `${userId}::${sessionId}`
  }

  private userHome(userId: string): string {
    return resolveUserCodexHome(userId, this.codexHomeBase)
  }

  private authPath(userId: string): string {
    return join(this.userHome(userId), 'auth.json')
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(url, init)
    if (!response.ok) {
      throw new Error(`Request to ${url} failed with status ${response.status}`)
    }
    return (await response.json()) as T
  }
}
