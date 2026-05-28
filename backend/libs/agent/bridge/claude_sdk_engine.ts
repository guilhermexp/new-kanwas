import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { ExecutionBridgeInput, ExecutionBridgeResult } from './types.js'
import type { NativeGenerateResult } from '../llm.js'
import type { State } from '../state.js'
import type { EventStream } from '../events.js'
import type { SandboxManager } from '../sandbox/index.js'
import type { ToolContext } from '../tools/context.js'
import type { AgentInfo } from '../types.js'
import { ClaudeEventMapper } from './claude_event_mapper.js'

// ============================================================================
// Types
// ============================================================================

export interface ClaudeSDKEngineOptions {
  /** Model to use (default: 'claude-sonnet-4-6') */
  model?: string
  /** Maximum turns for the Claude Agent SDK session */
  maxTurns?: number
}

/**
 * Events emitted by the bridge subprocess (NDJSON from stdout).
 */
interface BridgeEvent {
  type: 'ready' | 'started' | 'stream_event' | 'assistant' | 'tool_use' | 'result' | 'error'
  id?: string
  sdkPath?: string
  event?: unknown
  message?: unknown
  text?: string
  numTurns?: number
  durationMs?: number
  toolName?: string
  toolInput?: unknown
  toolUseId?: string
}

// ============================================================================
// ClaudeSDKEngine
// ============================================================================

/**
 * Execution engine that uses the Claude Agent SDK via a subprocess bridge.
 *
 * The Claude Agent SDK authenticates via the user's Claude Code subscription
 * (Claude Pro/Max) — NO API key needed. The SDK's `query()` function handles
 * the entire tool loop internally (bash, file editing, etc.) by spawning a
 * Claude Code session.
 *
 * Architecture:
 * 1. Spawns `claude_bridge.mjs` as a child process
 * 2. Sends requests via NDJSON on stdin
 * 3. Receives streaming events via NDJSON on stdout
 * 4. Maps SDK events to Kanwas timeline items
 *
 * The bridge sets `cwd` to the sandbox workspace path so that Claude Code's
 * built-in file tools operate on the same workspace that execenv monitors.
 */
export class ClaudeSDKEngine {
  private options: Required<ClaudeSDKEngineOptions>
  private bridgeProcess: ChildProcess | null = null
  private bridgeReady: Promise<void> | null = null
  private bridgeLineHandler: ((line: string) => void) | null = null

  constructor(options: ClaudeSDKEngineOptions = {}) {
    this.options = {
      model: options.model || 'claude-sonnet-4-6',
      maxTurns: options.maxTurns || 50,
    }
  }

  /**
   * Execute a user message through the Claude Agent SDK bridge.
   *
   * Sends the prompt to the bridge subprocess which delegates to Claude Code.
   * Claude Code handles the full tool loop (bash, file editing, web search, etc.)
   * and streams events back. We map those events to Kanwas timeline items.
   */
  async execute(
    input: ExecutionBridgeInput,
    state: State,
    eventStream: EventStream,
    sandboxManager: SandboxManager,
    _toolContext: ToolContext
  ): Promise<ExecutionBridgeResult> {
    const { flow, abortSignal } = input
    const agent: AgentInfo = { source: 'main' }

    // Resolve workspace path for the Claude Agent SDK session
    const workspacePath = await this.resolveWorkspacePath(sandboxManager)

    // Ensure bridge is running
    await this.ensureBridge(workspacePath)

    // Build system prompt
    const systemPrompt = flow.main.systemPrompts.map((p) => (typeof p === 'string' ? p : p.content)).join('\n\n')

    // Extract the last user message
    const messages = state.getMessages()
    const userPrompt = this.extractLastUserMessage(messages)
    if (!userPrompt) {
      throw new Error('No user message found in conversation state')
    }

    // Create event mapper
    const mapper = new ClaudeEventMapper(state, eventStream, agent)

    // Send request and collect result
    const requestId = randomUUID()
    const result = await this.sendRequest({
      requestId,
      systemPrompt,
      prompt: userPrompt,
      mapper,
      abortSignal,
    })

    return result
  }

  /**
   * Shut down the bridge subprocess.
   */
  async shutdown(): Promise<void> {
    if (this.bridgeProcess) {
      try {
        this.writeToBridge({ type: 'close' })
      } catch {
        // Ignore write errors during shutdown
      }
      this.bridgeProcess.kill('SIGTERM')

      // Force kill after 2 seconds
      const proc = this.bridgeProcess
      setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          // Already dead
        }
      }, 2000)

      this.bridgeProcess = null
      this.bridgeReady = null
    }
  }

  // --------------------------------------------------------------------------
  // Bridge Management
  // --------------------------------------------------------------------------

  private async ensureBridge(workspacePath: string): Promise<void> {
    if (this.bridgeProcess && !this.bridgeProcess.killed) {
      return
    }

    const bridgeScript = join(dirname(fileURLToPath(import.meta.url)), 'claude_bridge.mjs')

    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const currentPath = process.env.PATH || '/usr/bin:/usr/local/bin'
    const homeBin = join(process.env.HOME || '', '.local', 'bin')
    const claudeExecutable = process.env.CLAUDE_CODE_EXECUTABLE || process.env.CLAUDE_EXECUTABLE
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      KANWAS_CLAUDE_MODEL: this.options.model,
      KANWAS_CLAUDE_CWD: workspacePath,
      ...(claudeExecutable ? { KANWAS_CLAUDE_EXECUTABLE: claudeExecutable } : {}),
      NODE_PATH: join(projectRoot, 'node_modules'),
      PATH: `${homeBin}:${currentPath}`,
    }

    this.bridgeProcess = spawn(process.execPath, [bridgeScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })

    // Single persistent readline — events dispatched via bridgeLineHandler
    const rl = createInterface({ input: this.bridgeProcess!.stdout! })
    rl.on('line', (line: string) => {
      if (this.bridgeLineHandler) {
        this.bridgeLineHandler(line)
      }
    })

    // Wait for "ready" event
    this.bridgeReady = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Claude Agent SDK bridge did not become ready within 30s'))
      }, 30_000)

      this.bridgeLineHandler = (line: string) => {
        try {
          const event = JSON.parse(line) as BridgeEvent
          if (event.type === 'ready') {
            clearTimeout(timeout)
            this.bridgeLineHandler = null
            resolve()
          } else if (event.type === 'error' && !event.id) {
            clearTimeout(timeout)
            this.bridgeLineHandler = null
            reject(new Error((event.message as string) || 'Bridge startup error'))
          }
        } catch {
          // Ignore non-JSON lines during startup
        }
      }

      this.bridgeProcess!.on('exit', (code) => {
        clearTimeout(timeout)
        reject(new Error(`Claude Agent SDK bridge exited with code ${code}`))
      })
    })

    // Log stderr for debugging
    if (this.bridgeProcess.stderr) {
      const stderrRl = createInterface({ input: this.bridgeProcess.stderr })
      stderrRl.on('line', (line) => {
        console.error(`[claude-bridge stderr] ${line}`)
      })
    }

    await this.bridgeReady
  }

  private writeToBridge(data: Record<string, unknown>): void {
    if (!this.bridgeProcess?.stdin?.writable) {
      throw new Error('Bridge process stdin not writable')
    }
    this.bridgeProcess.stdin.write(JSON.stringify(data) + '\n')
  }

  // --------------------------------------------------------------------------
  // Request Handling
  // --------------------------------------------------------------------------

  private async sendRequest(params: {
    requestId: string
    systemPrompt: string
    prompt: string
    mapper: ClaudeEventMapper
    abortSignal: AbortSignal | undefined
  }): Promise<NativeGenerateResult> {
    const { requestId, systemPrompt, prompt, mapper, abortSignal } = params

    return new Promise<NativeGenerateResult>((resolve, reject) => {
      if (abortSignal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }

      const toolResults: NativeGenerateResult['toolResults'] = []

      const cleanup = () => {
        this.bridgeLineHandler = null
        if (abortSignal) {
          abortSignal.removeEventListener('abort', onAbort)
        }
      }

      const onAbort = () => {
        cleanup()
        reject(new DOMException('Aborted', 'AbortError'))
      }

      if (abortSignal) {
        abortSignal.addEventListener('abort', onAbort, { once: true })
      }

      // Use the persistent readline via bridgeLineHandler
      this.bridgeLineHandler = (line: string) => {
        try {
          const event = JSON.parse(line) as BridgeEvent
          if (event.id && event.id !== requestId) return

          switch (event.type) {
            case 'started':
              break

            case 'stream_event':
              mapper.handleStreamEvent(event.event)
              break

            case 'assistant':
              break

            case 'tool_use':
              toolResults.push({
                toolName: event.toolName || 'unknown',
                input: event.toolInput,
                output: '',
              })
              mapper.handleToolUse(event.toolName || 'unknown', event.toolUseId || '')
              break

            case 'result': {
              cleanup()
              mapper.finalize()

              const chatText = mapper.getChatText() || (typeof event.text === 'string' ? event.text : '')
              const hasTextOutput = chatText.length > 0
              const hasPersistedChat = mapper.hasPersistedChatSegments()

              resolve({
                messages: [],
                iterations: event.numTurns || 1,
                toolResults,
                isTerminal: hasTextOutput || hasPersistedChat,
                textOutput: hasTextOutput ? chatText : undefined,
                textOutputItemId: mapper.getChatItemId(),
                hasPersistedChatOutput: hasPersistedChat,
              })
              break
            }

            case 'error': {
              cleanup()
              const errorMsg = typeof event.message === 'string' ? event.message : 'Claude Agent SDK bridge error'
              reject(new Error(errorMsg))
              break
            }
          }
        } catch {
          // Ignore malformed lines
        }
      }

      this.bridgeProcess!.on('exit', () => {
        if (this.bridgeLineHandler) {
          cleanup()
          reject(new Error('Claude Agent SDK bridge closed unexpectedly'))
        }
      })

      // Send the request
      this.writeToBridge({
        type: 'request',
        id: requestId,
        systemPrompt,
        prompt,
      })
    })
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async resolveWorkspacePath(sandboxManager: SandboxManager): Promise<string> {
    await sandboxManager.ensureInitialized()
    const workspacePath = sandboxManager.getHostWorkspacePath()
    if (!workspacePath) {
      throw new Error(
        'Claude SDK execution engine requires SANDBOX_PROVIDER=host so Claude Code runs inside a host workspace'
      )
    }
    return workspacePath
  }

  private extractLastUserMessage(messages: unknown[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as Record<string, unknown>
      if (msg.role !== 'user') continue

      const content = msg.content
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        const textParts = content
          .filter((part: unknown) => {
            if (typeof part === 'string') return true
            if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text') return true
            return false
          })
          .map((part: unknown) =>
            typeof part === 'string' ? part : ((part as Record<string, unknown>).text as string)
          )
          .join('\n')
        if (textParts) return textParts
      }
    }
    return null
  }
}
