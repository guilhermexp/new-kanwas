import { Buffer } from 'node:buffer'
import type { CodexNotification } from './codex_process_manager.js'
import type {
  AgentEventType,
  ProgressItem,
  ThinkingItem,
  BashItem,
  TextEditorItem,
  WebSearchItem,
  ErrorItem,
} from '../types.js'

// ============================================================================
// Types
// ============================================================================

type TimelineItemPayload =
  | Omit<ProgressItem, 'id'>
  | Omit<ThinkingItem, 'id'>
  | Omit<BashItem, 'id'>
  | Omit<TextEditorItem, 'id'>
  | Omit<WebSearchItem, 'id'>
  | Omit<ErrorItem, 'id'>

export interface CodexTimelineAction {
  action: 'add' | 'update'
  item: TimelineItemPayload
  eventType: Exclude<AgentEventType, 'tool_streaming'>
  itemId?: string
}

export interface CodexStreamingAction {
  type: 'chat_streaming' | 'thinking_streaming'
  text: string
  itemId: string
}

export interface CodexAssistantFinalAction {
  text: string
  itemId?: string
}

export type CodexMappedEvent =
  | { kind: 'timeline'; data: CodexTimelineAction }
  | { kind: 'streaming'; data: CodexStreamingAction }
  | { kind: 'assistant_final'; data: CodexAssistantFinalAction }
  | { kind: 'turn_completed' }
  | { kind: 'ignored' }

type CodexThreadItem = Record<string, unknown> & {
  id?: string
  type?: string
}

// ============================================================================
// Event Mapper
// ============================================================================

/**
 * Stateful mapper for Codex app-server 0.134 notifications.
 *
 * The protocol sends deltas for assistant text, reasoning text, and command
 * output. Kanwas streaming events carry accumulated text, so this mapper keeps
 * per-item buffers and returns full text on each streaming update.
 */
export class CodexEventMapper {
  private readonly chatTextByItemId = new Map<string, string>()
  private readonly reasoningTextByItemId = new Map<string, string>()
  private readonly commandOutputByItemId = new Map<string, string>()
  private readonly commandByItemId = new Map<string, string>()
  private readonly commandCwdByItemId = new Map<string, string>()
  private readonly commandItemIdByProcessId = new Map<string, string>()
  private readonly plannedTimelineItemIds = new Set<string>()
  private finalAssistantText = ''
  private finalAssistantItemId: string | undefined

  map(notification: CodexNotification): CodexMappedEvent {
    const { method, params } = notification

    switch (method) {
      case 'turn/started':
        return this.mapTurnStarted(params)

      case 'item/agentMessage/delta':
        return this.mapAgentMessageDelta(params)

      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        return this.mapReasoningDelta(params)

      case 'item/plan/delta':
        return this.mapReasoningDelta(params)

      case 'item/started':
        return this.mapItemStarted(params.item as CodexThreadItem | undefined)

      case 'item/completed':
        return this.mapItemCompleted(params.item as CodexThreadItem | undefined)

      case 'turn/plan/updated':
        return this.mapTurnPlanUpdated(params)

      case 'command/exec/outputDelta':
        return this.mapCommandOutputDelta(params, true)

      case 'item/commandExecution/outputDelta':
        return this.mapCommandOutputDelta(params, false)

      case 'turn/completed':
        this.captureFinalAssistantFromTurn(params.turn as Record<string, unknown> | undefined)
        return { kind: 'turn_completed' }

      case 'error':
        return this.mapError(params)

      default:
        return { kind: 'ignored' }
    }
  }

  getFinalAssistantText(): CodexAssistantFinalAction | null {
    if (!this.finalAssistantText) return null
    return { text: this.finalAssistantText, itemId: this.finalAssistantItemId }
  }

  private mapTurnStarted(params: Record<string, unknown>): CodexMappedEvent {
    const turn = params.turn as Record<string, unknown> | undefined
    const turnId = stringValue(turn?.id) || stringValue(params.turnId) || 'current'
    const itemId = `codex-turn-${turnId}-progress`
    const item: Omit<ProgressItem, 'id'> = {
      type: 'progress',
      message: 'Codex agent loop started',
      timestamp: Date.now(),
    }
    return { kind: 'timeline', data: { action: 'add', item, eventType: 'progress', itemId } }
  }

  private mapAgentMessageDelta(params: Record<string, unknown>): CodexMappedEvent {
    const itemId = stringValue(params.itemId) || 'codex-assistant'
    const text = this.appendToBuffer(this.chatTextByItemId, itemId, stringValue(params.delta))
    return {
      kind: 'streaming',
      data: {
        type: 'chat_streaming',
        text,
        itemId,
      },
    }
  }

  private mapReasoningDelta(params: Record<string, unknown>): CodexMappedEvent {
    const itemId = stringValue(params.itemId) || 'codex-reasoning'
    const text = this.appendToBuffer(this.reasoningTextByItemId, itemId, stringValue(params.delta))
    return {
      kind: 'streaming',
      data: {
        type: 'thinking_streaming',
        text,
        itemId,
      },
    }
  }

  private mapItemStarted(item: CodexThreadItem | undefined): CodexMappedEvent {
    if (!item) return { kind: 'ignored' }

    const itemId = stringValue(item.id)

    switch (item.type) {
      case 'reasoning': {
        const thought = extractReasoningText(item) || 'Analyzing the task...'
        if (itemId) this.reasoningTextByItemId.set(itemId, thought)
        const payload: Omit<ThinkingItem, 'id'> = {
          type: 'thinking',
          thought,
          streaming: true,
          timestamp: Date.now(),
        }
        return { kind: 'timeline', data: { action: 'add', item: payload, eventType: 'thinking', itemId } }
      }

      case 'plan': {
        const thought = stringValue(item.text) || 'Planning next steps...'
        if (itemId) this.reasoningTextByItemId.set(itemId, thought)
        const payload: Omit<ThinkingItem, 'id'> = {
          type: 'thinking',
          thought,
          streaming: true,
          timestamp: Date.now(),
        }
        return { kind: 'timeline', data: { action: 'add', item: payload, eventType: 'thinking', itemId } }
      }

      case 'commandExecution': {
        const command = stringValue(item.command)
        const cwd = stringValue(item.cwd)
        const processId = stringValue(item.processId)
        if (itemId) {
          this.commandByItemId.set(itemId, command)
          this.commandCwdByItemId.set(itemId, cwd)
          if (processId) {
            this.commandItemIdByProcessId.set(processId, itemId)
          }
        }
        const payload: Omit<BashItem, 'id'> = {
          type: 'bash',
          command,
          cwd,
          status: 'executing',
          output: this.getCommandOutput(itemId),
          timestamp: Date.now(),
        }
        return { kind: 'timeline', data: { action: 'add', item: payload, eventType: 'bash_started', itemId } }
      }

      case 'fileChange': {
        const payload: Omit<TextEditorItem, 'id'> = {
          type: 'text_editor',
          command: 'str_replace',
          path: extractFileChangePath(item),
          status: 'executing',
          timestamp: Date.now(),
        }
        return { kind: 'timeline', data: { action: 'add', item: payload, eventType: 'text_editor_started', itemId } }
      }

      case 'webSearch': {
        const payload: Omit<WebSearchItem, 'id'> = {
          type: 'web_search',
          objective: extractWebSearchObjective(item),
          status: 'searching',
          timestamp: Date.now(),
        }
        return { kind: 'timeline', data: { action: 'add', item: payload, eventType: 'web_search_started', itemId } }
      }

      case 'agentMessage':
        return { kind: 'ignored' }

      default:
        return { kind: 'ignored' }
    }
  }

  private mapItemCompleted(item: CodexThreadItem | undefined): CodexMappedEvent {
    if (!item) return { kind: 'ignored' }

    const itemId = stringValue(item.id)

    switch (item.type) {
      case 'agentMessage': {
        const text = stringValue(item.text) || (itemId ? this.chatTextByItemId.get(itemId) : '') || ''
        if (!text) return { kind: 'ignored' }
        this.finalAssistantText = text
        this.finalAssistantItemId = itemId || undefined
        return { kind: 'assistant_final', data: { text, itemId: itemId || undefined } }
      }

      case 'reasoning': {
        const thought = extractReasoningText(item) || this.getReasoningText(itemId) || 'Finished reasoning.'
        const payload: Omit<ThinkingItem, 'id'> = {
          type: 'thinking',
          thought,
          streaming: false,
          timestamp: Date.now(),
        }
        return { kind: 'timeline', data: { action: 'update', itemId, item: payload, eventType: 'thinking' } }
      }

      case 'commandExecution': {
        const processId = stringValue(item.processId)
        if (itemId && processId) {
          this.commandItemIdByProcessId.set(processId, itemId)
        }
        const command = stringValue(item.command) || this.getCommand(itemId)
        const cwd = stringValue(item.cwd) || this.getCommandCwd(itemId)
        const output = nullableString(item.aggregatedOutput) ?? this.getCommandOutput(itemId)
        const exitCode = numberValue(item.exitCode)
        const status = mapCommandStatus(stringValue(item.status), exitCode)
        const payload: Omit<BashItem, 'id'> = {
          type: 'bash',
          command,
          cwd,
          status,
          exitCode,
          output,
          timestamp: Date.now(),
        }
        const eventType = status === 'failed' ? 'bash_failed' : 'bash_completed'
        return { kind: 'timeline', data: { action: 'update', itemId, item: payload, eventType } }
      }

      case 'fileChange': {
        const status = mapTextEditorStatus(stringValue(item.status))
        const payload: Omit<TextEditorItem, 'id'> = {
          type: 'text_editor',
          command: 'str_replace',
          path: extractFileChangePath(item),
          status,
          timestamp: Date.now(),
        }
        const eventType = status === 'failed' ? 'text_editor_failed' : 'text_editor_completed'
        return { kind: 'timeline', data: { action: 'update', itemId, item: payload, eventType } }
      }

      case 'plan': {
        const thought = stringValue(item.text) || this.getReasoningText(itemId)
        if (!thought) return { kind: 'ignored' }
        const payload: Omit<ThinkingItem, 'id'> = {
          type: 'thinking',
          thought,
          streaming: false,
          timestamp: Date.now(),
        }
        return { kind: 'timeline', data: { action: 'update', itemId, item: payload, eventType: 'thinking' } }
      }

      case 'webSearch': {
        const payload: Omit<WebSearchItem, 'id'> = {
          type: 'web_search',
          objective: extractWebSearchObjective(item),
          status: 'completed',
          timestamp: Date.now(),
        }
        return {
          kind: 'timeline',
          data: { action: 'update', itemId, item: payload, eventType: 'web_search_completed' },
        }
      }

      default:
        return { kind: 'ignored' }
    }
  }

  private mapTurnPlanUpdated(params: Record<string, unknown>): CodexMappedEvent {
    const turnId = stringValue(params.turnId) || 'current'
    const itemId = `codex-plan-${turnId}`
    const planText = formatPlanUpdate(params)
    if (!planText) return { kind: 'ignored' }

    const item: Omit<ThinkingItem, 'id'> = {
      type: 'thinking',
      thought: planText,
      streaming: true,
      timestamp: Date.now(),
    }

    const action = this.plannedTimelineItemIds.has(itemId) ? 'update' : 'add'
    this.plannedTimelineItemIds.add(itemId)
    return { kind: 'timeline', data: { action, item, eventType: 'thinking', itemId } }
  }

  private mapCommandOutputDelta(params: Record<string, unknown>, isBase64: boolean): CodexMappedEvent {
    const processId = stringValue(params.processId)
    const itemId =
      stringValue(params.itemId) ||
      (processId ? (this.commandItemIdByProcessId.get(processId) ?? '') : '') ||
      stringValue(params.callId) ||
      processId ||
      'codex-command'
    const rawDelta = isBase64 ? decodeBase64(stringValue(params.deltaBase64)) : stringValue(params.delta)
    const output = this.appendToBuffer(this.commandOutputByItemId, itemId, rawDelta)
    const item: Omit<BashItem, 'id'> = {
      type: 'bash',
      command: this.getCommand(itemId),
      cwd: this.getCommandCwd(itemId),
      status: 'executing',
      output,
      timestamp: Date.now(),
    }
    return { kind: 'timeline', data: { action: 'update', itemId, item, eventType: 'bash_output' } }
  }

  private mapError(params: Record<string, unknown>): CodexMappedEvent {
    const errorMessage = extractErrorMessage(params)
    const item: Omit<ErrorItem, 'id'> = {
      type: 'error',
      error: {
        code: 'CODEX_ERROR',
        message: errorMessage,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    }
    return { kind: 'timeline', data: { action: 'add', item, eventType: 'error' } }
  }

  private captureFinalAssistantFromTurn(turn: Record<string, unknown> | undefined): void {
    const items = Array.isArray(turn?.items) ? turn.items : []
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index] as CodexThreadItem
      if (item?.type !== 'agentMessage') continue
      const text = stringValue(item.text)
      if (!text) continue
      this.finalAssistantText = text
      this.finalAssistantItemId = stringValue(item.id) || undefined
      return
    }
  }

  private appendToBuffer(buffer: Map<string, string>, key: string, delta: string): string {
    const next = `${buffer.get(key) ?? ''}${delta}`
    buffer.set(key, next)
    return next
  }

  private getReasoningText(itemId: string): string {
    return itemId ? (this.reasoningTextByItemId.get(itemId) ?? '') : ''
  }

  private getCommand(itemId: string): string {
    return itemId ? (this.commandByItemId.get(itemId) ?? '') : ''
  }

  private getCommandCwd(itemId: string): string {
    return itemId ? (this.commandCwdByItemId.get(itemId) ?? '') : ''
  }

  private getCommandOutput(itemId: string): string {
    return itemId ? (this.commandOutputByItemId.get(itemId) ?? '') : ''
  }
}

/** Compatibility wrapper for tests that map one notification at a time. */
export function mapCodexNotification(notification: CodexNotification): CodexMappedEvent {
  return new CodexEventMapper().map(notification)
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function joinStringArray(value: unknown): string {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').join('\n') : ''
}

function extractReasoningText(item: CodexThreadItem): string {
  return joinStringArray(item.content) || joinStringArray(item.summary)
}

function extractFileChangePath(item: CodexThreadItem): string {
  const changes = Array.isArray(item.changes) ? item.changes : []
  const firstChange = changes[0] as Record<string, unknown> | undefined
  return stringValue(firstChange?.path) || stringValue(item.path) || stringValue(item.filename)
}

function extractWebSearchObjective(item: CodexThreadItem): string {
  const action = item.action as Record<string, unknown> | undefined
  if (!action) return 'Web search'

  const queries = Array.isArray(action.queries)
    ? action.queries.filter((query): query is string => typeof query === 'string')
    : []

  return stringValue(action.query) || queries.join(', ') || stringValue(action.url) || 'Web search'
}

function mapCommandStatus(status: string, exitCode: number | undefined): BashItem['status'] {
  if (status === 'inProgress') return 'executing'
  if (status === 'failed' || status === 'declined') return 'failed'
  if (typeof exitCode === 'number' && exitCode !== 0) return 'failed'
  return 'completed'
}

function mapTextEditorStatus(status: string): TextEditorItem['status'] {
  if (status === 'failed' || status === 'declined') return 'failed'
  if (status === 'inProgress') return 'executing'
  return 'completed'
}

function formatPlanUpdate(params: Record<string, unknown>): string {
  const explanation = stringValue(params.explanation)
  const plan = Array.isArray(params.plan) ? params.plan : []
  const steps = plan
    .map((entry) => {
      const step = entry as Record<string, unknown>
      const text = stringValue(step.step)
      if (!text) return ''
      const status = stringValue(step.status)
      return status ? `- [${status}] ${text}` : `- ${text}`
    })
    .filter(Boolean)

  return [explanation, steps.join('\n')].filter(Boolean).join('\n\n')
}

function decodeBase64(value: string): string {
  if (!value) return ''
  try {
    return Buffer.from(value, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

function extractErrorMessage(params: Record<string, unknown>): string {
  if (typeof params.message === 'string') return params.message

  const error = params.error as Record<string, unknown> | undefined
  if (error) {
    if (typeof error.message === 'string') return error.message
    const details = error.additionalDetails
    if (typeof details === 'string') return details
  }

  return 'Codex app-server emitted an error'
}
