import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

// ============================================================================
// Types
// ============================================================================

export interface CodexProcessManagerOptions {
  /** Path to the codex executable (default: 'codex') */
  executable?: string
  /** Working directory for the codex process */
  workingDirectory: string
  /** Request timeout for app-server JSON-RPC calls */
  requestTimeoutMs?: number
}

export interface CodexCreateThreadOptions {
  model?: string
  baseInstructions?: string
  developerInstructions?: string
}

export interface CodexSendMessageOptions {
  threadId: string
  message: string
  model?: string
  workingDirectory?: string
}

/**
 * Events emitted by the Codex app-server process via JSON-RPC notifications.
 */
export interface CodexNotification {
  method: string
  params: Record<string, unknown>
}

type RequestId = string | number

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
}

// ============================================================================
// CodexProcessManager
// ============================================================================

/**
 * Manages the Codex CLI app-server subprocess.
 *
 * Spawns `codex app-server --listen stdio://` and communicates via newline
 * delimited JSON-RPC over stdin/stdout. Codex app-server 0.134 emits one JSON
 * object per line for responses and notifications.
 */
export class CodexProcessManager extends EventEmitter {
  private process: ChildProcess | null = null
  private messageId = 0
  private pendingRequests = new Map<RequestId, PendingRequest>()
  private stdoutBuffer = ''
  private hasInitialized = false
  private readonly executable: string
  private readonly workingDirectory: string
  private readonly requestTimeoutMs: number

  constructor(options: CodexProcessManagerOptions) {
    super()
    this.executable = options.executable || 'codex'
    this.workingDirectory = options.workingDirectory
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000
  }

  get isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.isRunning) return

    const proc = spawn(
      this.executable,
      ['app-server', '--listen', 'stdio://', '-c', 'approval_policy="never"', '-c', 'sandbox_mode="workspace-write"'],
      {
        cwd: this.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: this.ensurePaths(process.env.PATH || ''),
        },
      }
    )

    this.process = proc

    proc.stdout!.on('data', (data: Buffer) => {
      this.consumeStdout(data.toString('utf8'))
    })

    proc.stderr!.on('data', (data: Buffer) => {
      const line = data.toString('utf8').trim()
      if (line) {
        this.emit('stderr', line)
      }
    })

    proc.on('exit', (code) => {
      this.failAllPending(`Codex app-server exited with code ${code}`)
      this.process = null
      this.hasInitialized = false
      this.emit('exit', code)
    })

    proc.on('error', (err) => {
      this.failAllPending(`Codex app-server error: ${err.message}`)
      this.process = null
      this.hasInitialized = false
      this.emit('exit', null)
    })

    if (!this.hasInitialized) {
      await this.sendRequest('initialize', {
        clientInfo: {
          name: 'kanwas',
          title: 'Kanwas',
          version: '1.0.0',
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      })
      this.sendNotification('initialized')
      this.hasInitialized = true
    }
  }

  async createThread(options: CodexCreateThreadOptions = {}): Promise<string> {
    const result = await this.sendRequest('thread/start', {
      model: options.model,
      cwd: this.workingDirectory,
      runtimeWorkspaceRoots: [this.workingDirectory],
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      config: {
        approval_policy: 'never',
        sandbox_mode: 'workspace-write',
      },
      baseInstructions: options.baseInstructions || '',
      developerInstructions: options.developerInstructions || '',
      ephemeral: true,
    })

    const thread = result.thread as Record<string, unknown> | undefined
    const threadId = thread?.id as string | undefined

    if (!threadId) {
      throw new Error('Codex app-server did not return a thread id')
    }

    return threadId
  }

  async sendMessage(options: CodexSendMessageOptions): Promise<Record<string, unknown>> {
    const cwd = options.workingDirectory || this.workingDirectory
    return this.sendRequest('turn/start', {
      threadId: options.threadId,
      input: [
        {
          type: 'text',
          text: options.message,
          text_elements: [],
        },
      ],
      cwd,
      runtimeWorkspaceRoots: [cwd],
      approvalPolicy: 'never',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [cwd],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      model: options.model,
    })
  }

  async shutdown(): Promise<void> {
    if (!this.process) return

    this.process.stdout?.removeAllListeners()
    this.process.stderr?.removeAllListeners()

    if (this.process.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.end()
    }

    if (this.isRunning) {
      this.process.kill('SIGTERM')
    }

    this.failAllPending('Codex app-server stopped')
    this.process = null
    this.hasInitialized = false
  }

  // --------------------------------------------------------------------------
  // JSON-RPC transport
  // --------------------------------------------------------------------------

  private async sendRequest(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.isRunning) {
      throw new Error('Codex app-server is not running')
    }

    const id = ++this.messageId
    const message = JSON.stringify({ id, method, params }) + '\n'

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Codex app-server request timed out: ${method}`))
      }, this.requestTimeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timeout })
      this.process!.stdin!.write(message)
    })
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.isRunning) return

    const message: Record<string, unknown> = { method }
    if (params) message.params = params

    this.process!.stdin!.write(JSON.stringify(message) + '\n')
  }

  private consumeStdout(data: string): void {
    this.stdoutBuffer += data

    let newlineIndex: number
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex)
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)

      if (line.trim()) {
        this.handleLine(line)
      }
    }
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line)
    } catch {
      this.emit('stderr', `Could not parse Codex RPC line: ${line}`)
      return
    }

    const id = this.getMessageId(message)

    if (id !== undefined) {
      const pending = this.pendingRequests.get(id)
      this.pendingRequests.delete(id)

      if (!pending) return
      clearTimeout(pending.timeout)

      const error = message.error as Record<string, unknown> | undefined
      if (error) {
        const errorMessage = (error.message as string) || 'Codex app-server returned an error'
        pending.reject(new Error(errorMessage))
      } else {
        const result = (message.result as Record<string, unknown>) || {}
        pending.resolve(result)
      }
      return
    }

    const method = typeof message.method === 'string' ? message.method : undefined
    if (!method) return

    const notification: CodexNotification = {
      method,
      params: (message.params as Record<string, unknown>) || {},
    }
    this.emit('notification', notification)
  }

  private getMessageId(message: Record<string, unknown>): RequestId | undefined {
    if (typeof message.id === 'number' || typeof message.id === 'string') {
      return message.id
    }
    return undefined
  }

  private failAllPending(reason: string): void {
    const pending = Array.from(this.pendingRequests.values())
    this.pendingRequests.clear()
    for (const p of pending) {
      clearTimeout(p.timeout)
      p.reject(new Error(reason))
    }
  }

  private ensurePaths(existingPath: string): string {
    const required = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
    const parts = existingPath.split(':').filter(Boolean)
    for (const p of required) {
      if (!parts.includes(p)) {
        parts.push(p)
      }
    }
    return parts.join(':')
  }
}
