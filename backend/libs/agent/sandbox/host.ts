import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { BaseSandbox, type SandboxMetrics } from './base.js'
import type { SandboxInitOptions } from './types.js'

interface HostSandboxState {
  sandboxId: string
  workspacePath: string
  execenvProcess: ChildProcess
}

function findProjectRoot(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  let dir = currentDir

  while (dir !== '/') {
    if (existsSync(join(dir, 'execenv', 'package.json'))) {
      return dir
    }
    dir = dirname(dir)
  }

  throw new Error('Could not find project root (looking for execenv/package.json)')
}

function isInsidePath(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`)
}

export class HostSandbox extends BaseSandbox {
  private static readonly states = new Map<string, HostSandboxState>()
  private static readonly WORKSPACE_ROOT = '/workspace'

  private sandboxId: string | null = null
  private workspacePath: string | null = null
  private execenvProcess: ChildProcess | null = null
  private execenvExitError: Error | null = null

  private getWorkspacePath(): string {
    if (!this.workspacePath) {
      throw new Error('Host sandbox not initialized')
    }
    return this.workspacePath
  }

  private resolveHostPath(path: string): string {
    const workspacePath = this.getWorkspacePath()
    const relativePath =
      path === HostSandbox.WORKSPACE_ROOT
        ? ''
        : path.startsWith(`${HostSandbox.WORKSPACE_ROOT}/`)
          ? path.slice(HostSandbox.WORKSPACE_ROOT.length + 1)
          : path

    const resolvedPath = resolve(workspacePath, relativePath)
    if (!isInsidePath(workspacePath, resolvedPath)) {
      throw new Error(`Path escapes workspace: ${path}`)
    }

    return resolvedPath
  }

  private resolveCwd(cwd: string | undefined): string {
    return this.resolveHostPath(cwd ?? HostSandbox.WORKSPACE_ROOT)
  }

  private mapWorkspacePathReferences(command: string): string {
    return command.replace(/\/workspace(?=\/|$)/g, this.getWorkspacePath())
  }

  private buildExecenvPath(): string {
    const projectRoot = findProjectRoot()
    const execenvPath = join(projectRoot, 'execenv', 'dist', 'index.js')
    if (!existsSync(execenvPath)) {
      throw new Error(`Execenv build not found at ${execenvPath}. Run pnpm --filter @kanwas/execenv build.`)
    }
    return execenvPath
  }

  private attachProcessListeners(child: ChildProcess, sandboxId: string): void {
    child.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(`[HostSandbox:${sandboxId}] ${data.toString()}`)
    })

    child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(`[HostSandbox:${sandboxId}] ${data.toString()}`)
    })

    child.on('exit', (code, signal) => {
      if (this.execenvProcess === child) {
        this.ready = false
        this.execenvExitError = new Error(
          `Execenv exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
        )
      }

      const state = HostSandbox.states.get(sandboxId)
      if (state?.execenvProcess === child) {
        HostSandbox.states.delete(sandboxId)
      }
    })
  }

  private async waitForExecenvReady(): Promise<void> {
    const workspacePath = this.getWorkspacePath()
    const readyPath = join(workspacePath, '.ready')
    console.log(`[HostSandbox] Waiting for sandbox to become ready...`)
    await this.waitForReady(async () => {
      if (this.execenvExitError) {
        throw this.execenvExitError
      }

      try {
        await access(readyPath)
        return true
      } catch {
        return false
      }
    })
  }

  private startExecenv(options: SandboxInitOptions, sandboxId: string, workspacePath: string): ChildProcess {
    const yjsServerHost = this.config.yjsServerHost
    if (!yjsServerHost) {
      throw new Error('Sandbox config is missing yjsServerHost')
    }

    const execenvPath = this.buildExecenvPath()
    console.log(`[HostSandbox] Starting execenv for ${sandboxId}...`)
    console.log(`[HostSandbox] Workspace path: ${workspacePath}`)
    console.log(`[HostSandbox] Yjs server host: ${yjsServerHost}`)
    console.log(`[HostSandbox] Yjs server protocol: ${this.config.yjsServerProtocol ?? 'ws'}`)
    console.log(`[HostSandbox] Backend URL: ${this.config.backendUrl}`)

    return spawn(process.execPath, [execenvPath], {
      cwd: findProjectRoot(),
      env: {
        ...process.env,
        WORKSPACE_ID: options.workspaceId,
        WORKSPACE_PATH: workspacePath,
        YJS_SERVER_HOST: yjsServerHost,
        YJS_SERVER_PROTOCOL: this.config.yjsServerProtocol ?? 'ws',
        BACKEND_URL: this.config.backendUrl,
        AUTH_TOKEN: options.authToken,
        ASSEMBLYAI_API_KEY: this.config.assemblyaiApiKey ?? '',
        USER_ID: options.userId,
        CORRELATION_ID: options.correlationId,
        SENTRY_DSN: this.config.sentryDsn ?? '',
        LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  private runHostCommand(
    command: string,
    options?: {
      cwd?: string
      timeoutMs?: number
      onStdout?: (data: string) => void
      onStderr?: (data: string) => void
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }> {
    const cwd = this.resolveCwd(options?.cwd)
    const mappedCommand = this.mapWorkspacePathReferences(command)

    return new Promise((resolveResult, reject) => {
      const child = spawn('sh', ['-c', mappedCommand], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false
      let resolved = false

      const timer =
        options?.timeoutMs && options.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true
              child.kill('SIGKILL')
            }, options.timeoutMs)
          : null

      const finish = (result: { stdout: string; stderr: string; exitCode: number; timedOut?: boolean }) => {
        if (resolved) {
          return
        }

        resolved = true
        if (timer) {
          clearTimeout(timer)
        }
        resolveResult(result)
      }

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        options?.onStdout?.(text)
      })

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString()
        stderr += text
        options?.onStderr?.(text)
      })

      child.on('error', (err) => {
        if (timer) {
          clearTimeout(timer)
        }
        if (!resolved) {
          console.log(`[HostSandbox] exec: error=${err.message}`)
          reject(err)
        }
      })

      child.on('close', (code) => {
        const exitCode = timedOut ? 124 : (code ?? 0)
        console.log(`[HostSandbox] exec: exitCode=${exitCode}`)
        finish({
          stdout,
          stderr,
          exitCode,
          timedOut: timedOut || undefined,
        })
      })
    })
  }

  async initialize(options: SandboxInitOptions): Promise<void> {
    this.workspaceId = options.workspaceId
    this.execenvExitError = null

    if (options.sandboxId) {
      const state = HostSandbox.states.get(options.sandboxId)
      if (!state) {
        throw new Error(`Host sandbox ${options.sandboxId} is not available`)
      }
      if (state.execenvProcess.exitCode !== null) {
        HostSandbox.states.delete(options.sandboxId)
        throw new Error(`Host sandbox ${options.sandboxId} is not running`)
      }

      this.sandboxId = state.sandboxId
      this.workspacePath = state.workspacePath
      this.execenvProcess = state.execenvProcess
      options.onSandboxId?.(this.sandboxId)

      console.log(`[HostSandbox] Attaching to sandbox ${this.sandboxId}...`)
      await this.waitForExecenvReady()
      console.log(`[HostSandbox] Sandbox is ready`)
      return
    }

    const safeWorkspaceId = options.workspaceId.replace(/[^a-zA-Z0-9_-]/g, '-')
    this.sandboxId = `host-${safeWorkspaceId}-${randomUUID()}`
    this.workspacePath = join(tmpdir(), 'kanwas-host-sandboxes', this.sandboxId, 'workspace')
    options.onSandboxId?.(this.sandboxId)

    await mkdir(this.workspacePath, { recursive: true })
    await rm(join(this.workspacePath, '.ready'), { force: true })

    this.execenvProcess = this.startExecenv(options, this.sandboxId, this.workspacePath)
    this.attachProcessListeners(this.execenvProcess, this.sandboxId)
    HostSandbox.states.set(this.sandboxId, {
      sandboxId: this.sandboxId,
      workspacePath: this.workspacePath,
      execenvProcess: this.execenvProcess,
    })

    await this.waitForExecenvReady()
    console.log(`[HostSandbox] Sandbox is ready`)
  }

  async shutdown(): Promise<void> {
    if (!this.sandboxId) {
      return
    }

    const sandboxId = this.sandboxId
    const workspacePath = this.workspacePath
    const execenvProcess = this.execenvProcess
    this.sandboxId = null
    this.workspacePath = null
    this.execenvProcess = null
    this.ready = false
    this.execenvExitError = null

    console.log(`[HostSandbox] Shutting down sandbox ${sandboxId}...`)
    HostSandbox.states.delete(sandboxId)

    if (execenvProcess && !execenvProcess.killed) {
      execenvProcess.kill('SIGTERM')
    }

    if (workspacePath) {
      await rm(dirname(workspacePath), { recursive: true, force: true }).catch(() => {})
    }

    console.log(`[HostSandbox] Sandbox shut down`)
  }

  async pause(): Promise<void> {
    console.warn(`[HostSandbox] pause is not supported for host sandboxes`)
  }

  async resume(): Promise<void> {
    console.warn(`[HostSandbox] resume is not supported for host sandboxes`)
  }

  async getMetricsAndCost(): Promise<SandboxMetrics | null> {
    return null
  }

  getSandboxId(): string | null {
    return this.sandboxId
  }

  getHostWorkspacePath(): string | null {
    return this.workspacePath
  }

  async readFile(path: string): Promise<string> {
    console.log(`[HostSandbox] readFile: ${path}`)
    return readFile(this.resolveHostPath(path), 'utf8')
  }

  async writeFile(path: string, content: string): Promise<void> {
    console.log(`[HostSandbox] writeFile: ${path} (${content.length} bytes)`)
    await writeFile(this.resolveHostPath(path), content)
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      await access(this.resolveHostPath(path))
      console.log(`[HostSandbox] fileExists: ${path} -> true`)
      return true
    } catch {
      console.log(`[HostSandbox] fileExists: ${path} -> false`)
      return false
    }
  }

  async isDirectory(path: string): Promise<boolean> {
    try {
      const stats = await stat(this.resolveHostPath(path))
      const isDir = stats.isDirectory()
      console.log(`[HostSandbox] isDirectory: ${path} -> ${isDir}`)
      return isDir
    } catch {
      console.log(`[HostSandbox] isDirectory: ${path} -> false`)
      return false
    }
  }

  async listDirectory(path: string): Promise<string[]> {
    console.log(`[HostSandbox] listDirectory: ${path}`)
    const entries = await readdir(this.resolveHostPath(path))
    console.log(`[HostSandbox] listDirectory: found ${entries.length} entries`)
    return entries
  }

  async exec(
    command: string,
    options?: { cwd?: string; timeoutMs?: number }
  ): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }> {
    const workDir = options?.cwd ?? HostSandbox.WORKSPACE_ROOT
    console.log(`[HostSandbox] exec: ${command} (cwd: ${workDir})`)
    return this.runHostCommand(command, options)
  }

  async execStreaming(
    command: string,
    options?: {
      cwd?: string
      timeoutMs?: number
      onStdout?: (data: string) => void
      onStderr?: (data: string) => void
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }> {
    const workDir = options?.cwd ?? HostSandbox.WORKSPACE_ROOT
    console.log(`[HostSandbox] execStreaming: ${command} (cwd: ${workDir})`)
    return this.runHostCommand(command, options)
  }
}
