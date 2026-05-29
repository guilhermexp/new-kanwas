import { test } from '@japa/runner'
import { CodexProcessManager } from '#agent/bridge/codex_process_manager'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Codex authenticates with the host's CLI login by seeding an isolated
 * CODEX_HOME with `~/.codex/auth.json` (mirrors the OpenClicky approach). The
 * token must never widen its file permissions, so the directory is 0700 and
 * the copied auth.json is 0600.
 */
function makeManager(opts: { codexHome: string; sourceAuthPath?: string }) {
  const manager = new CodexProcessManager({
    workingDirectory: opts.codexHome,
    codexHome: opts.codexHome,
    sourceAuthPath: opts.sourceAuthPath,
  })
  // prepareCodexHome is private; exercise it directly without spawning codex.
  return (manager as unknown as { prepareCodexHome(): string }).prepareCodexHome()
}

test.group('Codex CODEX_HOME seeding', (group) => {
  let workdir: string

  group.each.setup(() => {
    workdir = mkdtempSync(join(tmpdir(), 'kanwas-codex-test-'))
    return () => rmSync(workdir, { recursive: true, force: true })
  })

  test('seeds auth.json from the host login with owner-only permissions', ({ assert }) => {
    const source = join(workdir, 'source-auth.json')
    writeFileSync(source, '{"auth_mode":"chatgpt","tokens":{"access_token":"xyz"}}')

    const codexHome = join(workdir, 'home')
    const resolved = makeManager({ codexHome, sourceAuthPath: source })

    assert.equal(resolved, codexHome)
    assert.equal(statSync(codexHome).mode & 0o777, 0o700)

    const destAuth = join(codexHome, 'auth.json')
    assert.isTrue(existsSync(destAuth))
    assert.equal(readFileSync(destAuth, 'utf8'), readFileSync(source, 'utf8'))
    assert.equal(statSync(destAuth).mode & 0o777, 0o600)
  })

  test('does not overwrite an already-seeded auth.json', ({ assert }) => {
    const source = join(workdir, 'source-auth.json')
    writeFileSync(source, '{"token":"new"}')

    const codexHome = join(workdir, 'home')
    mkdirSync(codexHome, { recursive: true })
    const destAuth = join(codexHome, 'auth.json')
    writeFileSync(destAuth, '{"token":"existing"}')

    makeManager({ codexHome, sourceAuthPath: source })

    assert.equal(readFileSync(destAuth, 'utf8'), '{"token":"existing"}')
  })

  test('tightens permissions on a pre-existing broadly-readable home', ({ assert }) => {
    const codexHome = join(workdir, 'home')
    mkdirSync(codexHome, { recursive: true, mode: 0o755 })

    makeManager({ codexHome, sourceAuthPath: join(workdir, 'missing.json') })

    assert.equal(statSync(codexHome).mode & 0o777, 0o700)
  })

  test('does not throw and creates the home when the source login is absent', ({ assert }) => {
    const codexHome = join(workdir, 'home')

    assert.doesNotThrows(() => makeManager({ codexHome, sourceAuthPath: join(workdir, 'missing.json') }))
    assert.isTrue(existsSync(codexHome))
    assert.isFalse(existsSync(join(codexHome, 'auth.json')))
  })
})
