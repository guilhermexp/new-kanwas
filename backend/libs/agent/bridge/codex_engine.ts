import type { ExecutionBridgeInput, ExecutionBridgeResult } from './types.js'
import { resolveUserCodexHome } from '#services/codex_home'
import { CodexProcessManager, type CodexNotification } from './codex_process_manager.js'
import { CodexEventMapper, type CodexTimelineAction } from './codex_event_mapper.js'
import type { State } from '../state.js'
import type { EventStream } from '../events.js'
import type { SandboxManager } from '../sandbox/index.js'
import type { NativeGenerateResult } from '../llm.js'

// ============================================================================
// Types
// ============================================================================

export interface CodexEngineOptions {
  /** Path to the codex executable (default: 'codex') */
  executable?: string
  /** Model to use for Codex sessions */
  model?: string
}

type ToolResult = NativeGenerateResult['toolResults'][number]

// ============================================================================
// CodexEngine
// ============================================================================

/**
 * Execution engine that delegates the agent loop to Codex app-server.
 *
 * Codex runs as `codex app-server --listen stdio://` with its cwd set to the
 * host sandbox workspace. Codex notifications are translated into Kanwas
 * timeline and streaming events while the final assistant answer is returned to
 * CanvasAgent so it persists exactly one final chat item.
 */
export class CodexEngine {
  private processManager: CodexProcessManager | null = null
  private threadId: string | null = null
  private readonly options: CodexEngineOptions

  constructor(options: CodexEngineOptions = {}) {
    this.options = options
  }

  async execute(
    input: ExecutionBridgeInput,
    state: State,
    eventStream: EventStream,
    sandboxManager: SandboxManager
  ): Promise<ExecutionBridgeResult> {
    const workspacePath = await this.resolveWorkspacePath(sandboxManager)

    if (!this.processManager) {
      // The app-server runs under the per-user CODEX_HOME of the invoking user
      // (traceIdentity.distinctId is context.userId), so it only authenticates
      // with that user's own Codex credential.
      const userId = input.traceIdentity.distinctId
      this.processManager = new CodexProcessManager({
        executable: this.options.executable,
        workingDirectory: workspacePath,
        codexHome: resolveUserCodexHome(userId),
      })
      await this.processManager.start()
    }

    if (!this.threadId) {
      const systemPrompts = input.flow.main.systemPrompts
        .map((prompt) => (typeof prompt === 'string' ? prompt : prompt.content))
        .join('\n\n')

      this.threadId = await this.processManager.createThread({
        model: this.options.model,
        baseInstructions: systemPrompts,
      })
    }

    const lastUserMessage = this.extractLastUserMessage(state.getMessages())
    if (!lastUserMessage) {
      throw new Error('No user message found in conversation state')
    }

    const mapper = new CodexEventMapper()
    const toolResultsByItemId = new Map<string, ToolResult>()
    const countedToolItemIds = new Set<string>()
    let finalTextOutput = ''
    let finalTextItemId: string | undefined
    let iterations = 0

    const recordToolResult = (itemId: string, item: CodexTimelineAction['item']) => {
      if (item.type !== 'bash' && item.type !== 'text_editor' && item.type !== 'web_search') return

      if (!countedToolItemIds.has(itemId)) {
        countedToolItemIds.add(itemId)
        iterations += 1
      }

      if (item.type === 'bash') {
        toolResultsByItemId.set(itemId, {
          toolName: 'bash',
          input: { command: item.command, cwd: item.cwd },
          output: item.output || '',
        })
        return
      }

      if (item.type === 'text_editor') {
        toolResultsByItemId.set(itemId, {
          toolName: 'text_editor',
          input: { path: item.path, command: item.command },
          output: item.status,
        })
        return
      }

      toolResultsByItemId.set(itemId, {
        toolName: 'web_search',
        input: { objective: item.objective },
        output: item.status,
      })
    }

    const applyTimelineAction = (data: CodexTimelineAction) => {
      const itemId = data.itemId || undefined
      const existing = itemId ? state.findTimelineItem(itemId) : undefined

      if (data.action === 'update' && itemId && existing) {
        state.updateTimelineItem(itemId, data.item as never, data.eventType)
        recordToolResult(itemId, data.item)
        return
      }

      if (data.action === 'add' && itemId && existing) {
        state.updateTimelineItem(itemId, data.item as never, data.eventType)
        recordToolResult(itemId, data.item)
        return
      }

      const createdItemId = state.addTimelineItem(data.item as never, data.eventType, itemId)
      recordToolResult(createdItemId, data.item)
    }

    const turnComplete = new Promise<void>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        this.processManager?.removeListener('notification', onNotification)
        this.processManager?.removeListener('exit', onExit)
        input.abortSignal?.removeEventListener('abort', onAbort)
      }

      const settle = (callback: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }

      const onAbort = () => {
        settle(() => reject(new DOMException('Aborted', 'AbortError')))
      }

      const onExit = () => {
        settle(() => reject(new Error('Codex app-server exited before the turn completed')))
      }

      const onNotification = (notification: CodexNotification) => {
        if (input.abortSignal?.aborted) {
          onAbort()
          return
        }

        const mapped = mapper.map(notification)

        switch (mapped.kind) {
          case 'timeline':
            applyTimelineAction(mapped.data)
            break

          case 'streaming':
            eventStream.emitEvent({
              type: mapped.data.type,
              itemId: mapped.data.itemId,
              timestamp: Date.now(),
              streamingText: mapped.data.text,
            })
            break

          case 'assistant_final':
            finalTextOutput = mapped.data.text
            finalTextItemId = mapped.data.itemId
            break

          case 'turn_completed': {
            const finalAssistant = mapper.getFinalAssistantText()
            if (finalAssistant) {
              finalTextOutput = finalAssistant.text
              finalTextItemId = finalAssistant.itemId
            }
            settle(resolve)
            break
          }

          case 'ignored':
            break
        }
      }

      this.processManager!.on('notification', onNotification)
      this.processManager!.once('exit', onExit)
      input.abortSignal?.addEventListener('abort', onAbort, { once: true })
    })

    await this.processManager.sendMessage({
      threadId: this.threadId,
      message: lastUserMessage,
      model: this.options.model,
      workingDirectory: workspacePath,
    })

    await turnComplete

    const finalAssistant = mapper.getFinalAssistantText()
    if (!finalTextOutput && finalAssistant) {
      finalTextOutput = finalAssistant.text
      finalTextItemId = finalAssistant.itemId
    }

    return {
      messages: [],
      iterations: Math.max(iterations, 1),
      toolResults: Array.from(toolResultsByItemId.values()),
      isTerminal: !!finalTextOutput,
      textOutput: finalTextOutput || undefined,
      textOutputItemId: finalTextOutput ? finalTextItemId : undefined,
      hasPersistedChatOutput: false,
    }
  }

  async shutdown(): Promise<void> {
    if (this.processManager) {
      await this.processManager.shutdown()
      this.processManager = null
      this.threadId = null
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async resolveWorkspacePath(sandboxManager: SandboxManager): Promise<string> {
    await sandboxManager.ensureInitialized()
    const workspacePath = sandboxManager.getHostWorkspacePath()
    if (!workspacePath) {
      throw new Error('Codex execution engine requires SANDBOX_PROVIDER=host so the app-server cwd is a host workspace')
    }
    return workspacePath
  }

  private extractLastUserMessage(messages: unknown[]): string | null {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i] as Record<string, unknown>
      if (msg.role !== 'user') continue

      const content = msg.content
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        const textParts = content
          .filter((part: unknown) => {
            if (typeof part === 'string') return true
            return !!part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text'
          })
          .map((part: unknown) =>
            typeof part === 'string' ? part : String((part as Record<string, unknown>).text ?? '')
          )
          .filter(Boolean)
          .join('\n')
        if (textParts) return textParts
      }
    }
    return null
  }
}
