import { test } from '@japa/runner'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import CodexOauthService from '#services/codex_oauth_service'

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeCodexAccessToken(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }),
    'utf8'
  ).toString('base64url')
  return `header.${payload}.signature`
}

const USER_A = 'user-a'
const USER_B = 'user-b'

test.group('CodexOauthService', (group) => {
  let workdir: string
  let codexHomeBase: string

  group.each.setup(() => {
    workdir = mkdtempSync(join(tmpdir(), 'kanwas-codex-oauth-'))
    codexHomeBase = join(workdir, 'codex-home')
    return () => rmSync(workdir, { recursive: true, force: true })
  })

  function authPath(userId: string): string {
    return join(codexHomeBase, userId, 'auth.json')
  }

  test('starts an OpenAI Codex device-code session', async ({ assert }) => {
    const requests: Array<{ url: string; body: unknown }> = []
    const service = new CodexOauthService({
      codexHomeBase,
      sessionIdFactory: () => 'session-1',
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
        return jsonResponse(200, {
          user_code: 'PRXB-GQXG5',
          device_auth_id: 'device-123',
          interval: 7,
          expires_in: 900,
        })
      },
    })

    const result = await service.startDeviceLogin(USER_A)

    assert.equal(result.sessionId, 'session-1')
    assert.equal(result.userCode, 'PRXB-GQXG5')
    assert.equal(result.verificationUri, 'https://auth.openai.com/codex/device')
    assert.equal(result.intervalSeconds, 7)
    assert.equal(requests[0].url, 'https://auth.openai.com/api/accounts/deviceauth/usercode')
    assert.deepEqual(requests[0].body, { client_id: 'app_EMoamEEZ73f0CkXaXp7hrann' })
  })

  test('polls authorization, exchanges tokens, and writes a per-user auth.json with private permissions', async ({
    assert,
  }) => {
    let tokenPolls = 0
    const service = new CodexOauthService({
      codexHomeBase,
      sessionIdFactory: () => 'session-1',
      now: () => new Date(1_000_000),
      fetch: async (url, init) => {
        if (String(url).endsWith('/usercode')) {
          return jsonResponse(200, {
            user_code: 'PRXB-GQXG5',
            device_auth_id: 'device-123',
            interval: 3,
          })
        }
        if (String(url).endsWith('/deviceauth/token')) {
          const body = JSON.parse(String(init?.body))
          tokenPolls += 1
          assert.deepEqual(body, { device_auth_id: 'device-123', user_code: 'PRXB-GQXG5' })
          return jsonResponse(200, { authorization_code: 'auth-code', code_verifier: 'verifier' })
        }
        assert.equal(String(url), 'https://auth.openai.com/oauth/token')
        assert.include(String(init?.body), 'grant_type=authorization_code')
        assert.include(String(init?.body), 'code=auth-code')
        assert.include(String(init?.body), 'code_verifier=verifier')
        return jsonResponse(200, {
          access_token: fakeCodexAccessToken('acct-from-jwt'),
          refresh_token: 'refresh-token',
          id_token: 'id-token',
          expires_in: 3600,
        })
      },
    })

    await service.startDeviceLogin(USER_A)
    const result = await service.pollDeviceLogin(USER_A, 'session-1')

    assert.deepEqual(result, { status: 'connected' })
    assert.equal(tokenPolls, 1)

    const userAuthPath = authPath(USER_A)
    assert.isTrue(existsSync(userAuthPath))
    assert.equal(statSync(join(codexHomeBase, USER_A)).mode & 0o777, 0o700)
    assert.equal(statSync(userAuthPath).mode & 0o777, 0o600)

    const auth = JSON.parse(readFileSync(userAuthPath, 'utf8'))
    assert.equal(auth.auth_mode, 'chatgpt')
    assert.isNull(auth.OPENAI_API_KEY)
    assert.equal(auth.tokens.access_token, fakeCodexAccessToken('acct-from-jwt'))
    assert.equal(auth.tokens.refresh_token, 'refresh-token')
    assert.equal(auth.tokens.id_token, 'id-token')
    assert.equal(auth.tokens.account_id, 'acct-from-jwt')
    assert.equal(auth.tokens.expires_at, 1_000_000 + 3600 * 1000)

    // No temp files are left behind after the atomic rename.
    const leftovers = readdirSync(join(codexHomeBase, USER_A)).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(leftovers, [])
  })

  test('reports pending while OpenAI has not authorized the device code yet', async ({ assert }) => {
    const service = new CodexOauthService({
      codexHomeBase,
      sessionIdFactory: () => 'session-1',
      fetch: async (url) => {
        if (String(url).endsWith('/usercode')) {
          return jsonResponse(200, { user_code: 'ABCD-EFGH', device_auth_id: 'device-123' })
        }
        return jsonResponse(403, { error: 'authorization_pending' })
      },
    })

    await service.startDeviceLogin(USER_A)

    assert.deepEqual(await service.pollDeviceLogin(USER_A, 'session-1'), { status: 'pending' })
    assert.deepEqual(await service.getStatus(USER_A), { connected: false })
  })

  test('returns pending with an increased interval when OpenAI asks the client to slow down', async ({ assert }) => {
    const service = new CodexOauthService({
      codexHomeBase,
      sessionIdFactory: () => 'session-1',
      fetch: async (url) => {
        if (String(url).endsWith('/usercode')) {
          return jsonResponse(200, { user_code: 'ABCD-EFGH', device_auth_id: 'device-123', interval: 3 })
        }
        return jsonResponse(400, { error: { code: 'slow_down', message: 'Slow down' } })
      },
    })

    await service.startDeviceLogin(USER_A)

    assert.deepEqual(await service.pollDeviceLogin(USER_A, 'session-1'), { status: 'pending', intervalSeconds: 8 })
  })

  test('refreshes an expired stored credential before reporting connected', async ({ assert }) => {
    let nowMs = 2_000_000
    const userDir = join(codexHomeBase, USER_A)
    const userAuthPath = authPath(USER_A)
    mkdirSync(userDir, { recursive: true })
    writeFileSync(
      userAuthPath,
      JSON.stringify({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          access_token: fakeCodexAccessToken('old-account'),
          refresh_token: 'old-refresh-token',
          account_id: 'old-account',
          expires_at: nowMs - 1,
        },
        last_refresh: 'old-refresh-time',
      })
    )

    const requests: Array<{ url: string; body: string }> = []
    const service = new CodexOauthService({
      codexHomeBase,
      now: () => new Date(nowMs),
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: String(init?.body) })
        return jsonResponse(200, {
          access_token: fakeCodexAccessToken('new-account'),
          refresh_token: 'new-refresh-token',
          expires_in: 1800,
        })
      },
    })

    const status = await service.getStatus(USER_A)

    assert.deepEqual(status, { connected: true, lastRefresh: new Date(nowMs).toISOString() })
    assert.equal(requests[0].url, 'https://auth.openai.com/oauth/token')
    assert.include(requests[0].body, 'grant_type=refresh_token')
    assert.include(requests[0].body, 'refresh_token=old-refresh-token')

    const auth = JSON.parse(readFileSync(userAuthPath, 'utf8'))
    assert.equal(auth.tokens.access_token, fakeCodexAccessToken('new-account'))
    assert.equal(auth.tokens.refresh_token, 'new-refresh-token')
    assert.equal(auth.tokens.account_id, 'new-account')
    assert.equal(auth.tokens.expires_at, nowMs + 1800 * 1000)
  })

  test('isolates credentials per user', async ({ assert }) => {
    const service = new CodexOauthService({
      codexHomeBase,
      sessionIdFactory: () => 'session-1',
      fetch: async (url) => {
        if (String(url).endsWith('/usercode')) {
          return jsonResponse(200, { user_code: 'AAAA-BBBB', device_auth_id: 'device-a', interval: 3 })
        }
        if (String(url).endsWith('/deviceauth/token')) {
          return jsonResponse(200, { authorization_code: 'auth-code', code_verifier: 'verifier' })
        }
        return jsonResponse(200, {
          access_token: fakeCodexAccessToken('acct-a'),
          refresh_token: 'refresh-token-a',
          expires_in: 3600,
        })
      },
    })

    await service.startDeviceLogin(USER_A)
    await service.pollDeviceLogin(USER_A, 'session-1')

    // User A is connected; user B (who never connected) is not, and reads a
    // different credential location.
    const statusA = await service.getStatus(USER_A)
    assert.isTrue(statusA.connected)
    assert.deepEqual(await service.getStatus(USER_B), { connected: false })
    assert.isTrue(existsSync(authPath(USER_A)))
    assert.isFalse(existsSync(authPath(USER_B)))
  })

  test('one user cannot disconnect another user credential', async ({ assert }) => {
    const service = new CodexOauthService({
      codexHomeBase,
      sessionIdFactory: () => 'session-1',
      fetch: async (url) => {
        if (String(url).endsWith('/usercode')) {
          return jsonResponse(200, { user_code: 'AAAA-BBBB', device_auth_id: 'device-a', interval: 3 })
        }
        if (String(url).endsWith('/deviceauth/token')) {
          return jsonResponse(200, { authorization_code: 'auth-code', code_verifier: 'verifier' })
        }
        return jsonResponse(200, {
          access_token: fakeCodexAccessToken('acct-a'),
          refresh_token: 'refresh-token-a',
          expires_in: 3600,
        })
      },
    })

    await service.startDeviceLogin(USER_A)
    await service.pollDeviceLogin(USER_A, 'session-1')

    await service.disconnect(USER_B)

    // User B disconnecting only affects their own (empty) location.
    assert.isTrue(existsSync(authPath(USER_A)))
    const statusA = await service.getStatus(USER_A)
    assert.isTrue(statusA.connected)
  })

  test('rejects polling a session started by another user', async ({ assert }) => {
    const service = new CodexOauthService({
      codexHomeBase,
      sessionIdFactory: () => 'session-1',
      fetch: async (url) => {
        if (String(url).endsWith('/usercode')) {
          return jsonResponse(200, { user_code: 'AAAA-BBBB', device_auth_id: 'device-a', interval: 3 })
        }
        return jsonResponse(403, { error: 'authorization_pending' })
      },
    })

    const started = await service.startDeviceLogin(USER_A)

    await assert.rejects(
      () => service.pollDeviceLogin(USER_B, started.sessionId),
      'Codex device login session expired or does not exist'
    )
    // The owner can still poll their own session.
    assert.deepEqual(await service.pollDeviceLogin(USER_A, started.sessionId), { status: 'pending' })
  })

  test('cleans up and surfaces an error for an expired session', async ({ assert }) => {
    let nowMs = 1_000_000
    const service = new CodexOauthService({
      codexHomeBase,
      sessionIdFactory: () => 'session-1',
      now: () => new Date(nowMs),
      fetch: async (url) => {
        if (String(url).endsWith('/usercode')) {
          return jsonResponse(200, {
            user_code: 'AAAA-BBBB',
            device_auth_id: 'device-a',
            interval: 3,
            expires_in: 60,
          })
        }
        return jsonResponse(403, { error: 'authorization_pending' })
      },
    })

    const started = await service.startDeviceLogin(USER_A)
    nowMs += 61 * 1000

    await assert.rejects(() => service.pollDeviceLogin(USER_A, started.sessionId), 'Codex device login session expired')
    // Session was removed: a second poll reports it as non-existent.
    await assert.rejects(
      () => service.pollDeviceLogin(USER_A, started.sessionId),
      'Codex device login session expired or does not exist'
    )
  })

  test('writes auth.json atomically without deleting the previous file first', async ({ assert }) => {
    const service = new CodexOauthService({
      codexHomeBase,
      sessionIdFactory: () => 'session-1',
      fetch: async (url) => {
        if (String(url).endsWith('/usercode')) {
          return jsonResponse(200, { user_code: 'AAAA-BBBB', device_auth_id: 'device-a', interval: 3 })
        }
        if (String(url).endsWith('/deviceauth/token')) {
          return jsonResponse(200, { authorization_code: 'auth-code', code_verifier: 'verifier' })
        }
        return jsonResponse(200, {
          access_token: fakeCodexAccessToken('acct-1'),
          refresh_token: 'refresh-token-1',
          expires_in: 3600,
        })
      },
    })

    await service.startDeviceLogin(USER_A)
    await service.pollDeviceLogin(USER_A, 'session-1')

    const userDir = join(codexHomeBase, USER_A)
    const before = readFileSync(join(userDir, 'auth.json'), 'utf8')
    assert.include(before, fakeCodexAccessToken('acct-1'))

    // A second successful flow replaces the file; no temp artifacts remain.
    const service2 = new CodexOauthService({
      codexHomeBase,
      sessionIdFactory: () => 'session-2',
      fetch: async (url) => {
        if (String(url).endsWith('/usercode')) {
          return jsonResponse(200, { user_code: 'CCCC-DDDD', device_auth_id: 'device-b', interval: 3 })
        }
        if (String(url).endsWith('/deviceauth/token')) {
          return jsonResponse(200, { authorization_code: 'auth-code', code_verifier: 'verifier' })
        }
        return jsonResponse(200, {
          access_token: fakeCodexAccessToken('acct-2'),
          refresh_token: 'refresh-token-2',
          expires_in: 3600,
        })
      },
    })
    await service2.startDeviceLogin(USER_A)
    await service2.pollDeviceLogin(USER_A, 'session-2')

    const after = readFileSync(join(userDir, 'auth.json'), 'utf8')
    assert.include(after, fakeCodexAccessToken('acct-2'))
    const leftovers = readdirSync(userDir).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(leftovers, [])
  })
})
