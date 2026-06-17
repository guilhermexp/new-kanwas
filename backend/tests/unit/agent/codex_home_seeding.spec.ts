import { test } from '@japa/runner'
import { CodexProcessManager } from '#agent/bridge/codex_process_manager'
import { resolveUserCodexHome } from '#services/codex_home'
import { mkdtempSync, mkdirSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The agent runtime runs the Codex app-server under the invoking user's
 * per-user CODEX_HOME (`<base>/<userId>`). It must NOT seed that home with any
 * host credential: a user only has a usable Codex login if they completed the
 * OAuth device flow, so the operator's `~/.codex/auth.json` never leaks to
 * other tenants. The home stays owner-only (0700).
 */
function prepareHome(codexHome: string): string {
  const manager = new CodexProcessManager({ workingDirectory: codexHome, codexHome })
  // prepareCodexHome is private; exercise it directly without spawning codex.
  return (manager as unknown as { prepareCodexHome(): string }).prepareCodexHome()
}

test.group('Codex CODEX_HOME preparation', (group) => {
  let workdir: string

  group.each.setup(() => {
    workdir = mkdtempSync(join(tmpdir(), 'kanwas-codex-test-'))
    return () => rmSync(workdir, { recursive: true, force: true })
  })

  test('resolves a per-user CODEX_HOME under the base', ({ assert }) => {
    const base = join(workdir, 'codex-home')
    assert.equal(resolveUserCodexHome('user-123', base), join(base, 'user-123'))
  })

  test('rejects resolving a CODEX_HOME without a userId', ({ assert }) => {
    assert.throws(() => resolveUserCodexHome('', join(workdir, 'codex-home')))
  })

  test('creates the home with owner-only permissions', ({ assert }) => {
    const codexHome = join(workdir, 'home')
    const resolved = prepareHome(codexHome)

    assert.equal(resolved, codexHome)
    assert.isTrue(existsSync(codexHome))
    assert.equal(statSync(codexHome).mode & 0o777, 0o700)
  })

  test('does NOT seed any auth.json into the home', ({ assert }) => {
    // Even if a host login exists, it must never be copied into a user home.
    const hostAuth = join(workdir, 'host-auth.json')
    writeFileSync(hostAuth, '{"auth_mode":"chatgpt","tokens":{"access_token":"xyz"}}')

    const codexHome = join(workdir, 'home')
    prepareHome(codexHome)

    assert.isFalse(existsSync(join(codexHome, 'auth.json')))
  })

  test('preserves a credential the user already wrote via the device flow', ({ assert }) => {
    const codexHome = join(workdir, 'home')
    mkdirSync(codexHome, { recursive: true })
    const destAuth = join(codexHome, 'auth.json')
    writeFileSync(destAuth, '{"tokens":{"access_token":"from-device-flow"}}')

    prepareHome(codexHome)

    assert.isTrue(existsSync(destAuth))
  })

  test('tightens permissions on a pre-existing broadly-readable home', ({ assert }) => {
    const codexHome = join(workdir, 'home')
    mkdirSync(codexHome, { recursive: true, mode: 0o755 })

    prepareHome(codexHome)

    assert.equal(statSync(codexHome).mode & 0o777, 0o700)
  })
})
