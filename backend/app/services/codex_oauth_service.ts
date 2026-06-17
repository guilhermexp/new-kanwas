import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { codexHomeBase, resolveUserCodexHome } from '#services/codex_home'

const OPENAI_ISSUER = 'https://auth.openai.com'
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_OAUTH_TOKEN_URL = `${OPENAI_ISSUER}/oauth/token`
const CODEX_VERIFICATION_URI = `${OPENAI_ISSUER}/codex/device`
const DEFAULT_EXPIRES_IN_SECONDS = 15 * 60

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

export type CodexDeviceLoginPollResult = { status: 'pending' } | { status: 'connected' }

export interface CodexOauthStatus {
  connected: boolean
  lastRefresh?: string
}

interface PendingDeviceSession {
  userId: string
  userCode: string
  deviceAuthId: string
  expiresAtMs: number
}

interface DeviceUserCodeResponse {
  user_code?: string
  device_auth_id?: string
  interval?: number | string
  expires_in?: number | string
}

interface DeviceTokenResponse {
  authorization_code?: string
  code_verifier?: string
}

type TokenResponse = Record<string, unknown> & {
  access_token?: string
  refresh_token?: string
}

// Keyed by `<userId>::<sessionId>` so a session started by one user can never
// be polled or observed by another.
const pendingSessions = new Map<string, PendingDeviceSession>()

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
    const authPath = this.authPath(userId)
    if (!existsSync(authPath)) {
      return { connected: false }
    }

    try {
      const raw = JSON.parse(readFileSync(authPath, 'utf8')) as {
        tokens?: { access_token?: string }
        last_refresh?: string
      }
      const connected = Boolean(raw.tokens?.access_token)
      return connected ? { connected: true, lastRefresh: raw.last_refresh } : { connected: false }
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
    const expiresInSeconds = Math.max(
      60,
      Number(response.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS) || DEFAULT_EXPIRES_IN_SECONDS
    )
    const expiresAtMs = this.now().getTime() + expiresInSeconds * 1000

    pendingSessions.set(this.sessionKey(userId, sessionId), {
      userId,
      userCode: response.user_code,
      deviceAuthId: response.device_auth_id,
      expiresAtMs,
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

    if (pollResponse.status === 403 || pollResponse.status === 404) {
      return { status: 'pending' }
    }

    if (!pollResponse.ok) {
      throw new Error(`OpenAI device auth polling failed with status ${pollResponse.status}`)
    }

    const deviceToken = (await pollResponse.json()) as DeviceTokenResponse
    if (!deviceToken.authorization_code || !deviceToken.code_verifier) {
      throw new Error('OpenAI device auth response is missing authorization_code or code_verifier')
    }

    const tokens = await this.exchangeAuthorizationCode(deviceToken.authorization_code, deviceToken.code_verifier)
    this.writeCodexAuth(userId, tokens)
    pendingSessions.delete(sessionKey)

    return { status: 'connected' }
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

    const tokens = await this.fetchJson<TokenResponse>(CODEX_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    if (!tokens.access_token) {
      throw new Error('OpenAI token exchange did not return an access_token')
    }

    return tokens
  }

  private writeCodexAuth(userId: string, tokens: TokenResponse): void {
    const userHome = this.userHome(userId)
    mkdirSync(userHome, { recursive: true, mode: 0o700 })
    chmodSync(userHome, 0o700)

    const payload = {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens,
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
