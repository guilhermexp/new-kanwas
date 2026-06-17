import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Base directory that holds every user's isolated Codex home. Each user's
 * credential lives under `<base>/<userId>`; the base is never used directly as a
 * credential path, so one user's auth.json can never be read or removed by
 * another.
 */
export function codexHomeBase(): string {
  return process.env.CODEX_HOME || join(homedir(), '.kanwas', 'codex-home')
}

/**
 * Resolves the per-user CODEX_HOME, keyed by the authenticated user id. The
 * OAuth service writes the credential here and the agent runtime reads it, so
 * both sides must derive the path the same way.
 */
export function resolveUserCodexHome(userId: string, base: string = codexHomeBase()): string {
  if (!userId) {
    throw new Error('resolveUserCodexHome requires a userId')
  }
  return join(base, userId)
}
