import type { State } from '../state.js'
import type { EventStream } from '../events.js'
import type { AgentInfo } from '../types.js'

// ============================================================================
// Types
// ============================================================================

interface StreamingState {
  /** Active thinking timeline item ID */
  thinkingItemId: string | null
  /** Accumulated thinking text */
  thinkingText: string
  /** Timestamp when thinking started */
  thinkingStartTime: number | null
  /** Active chat text timeline item ID */
  chatItemId: string | null
  /** Accumulated chat text */
  chatText: string
  /** Whether any chat segments have been persisted */
  hasPersistedChat: boolean
  /** Map of tool_use block IDs to timeline item IDs */
  toolItemIds: Map<string, string>
}

/**
 * Shape of a content_block_start event from the Anthropic streaming API.
 * Received via the bridge subprocess as part of stream_event messages.
 */
interface ContentBlockStartEvent {
  type: 'content_block_start'
  index: number
  content_block: {
    type: 'thinking' | 'text' | 'tool_use'
    thinking?: string
    text?: string
    id?: string
    name?: string
    input?: unknown
  }
}

interface ContentBlockDeltaEvent {
  type: 'content_block_delta'
  index: number
  delta: {
    type: 'thinking_delta' | 'text_delta' | 'input_json_delta'
    thinking?: string
    text?: string
    partial_json?: string
  }
}

interface ContentBlockStopEvent {
  type: 'content_block_stop'
  index: number
}

type StreamEvent =
  | { type: 'message_start'; message?: unknown }
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | { type: 'message_delta'; delta?: unknown }
  | { type: 'message_stop' }

// ============================================================================
// ClaudeEventMapper
// ============================================================================

/**
 * Maps Claude Agent SDK streaming events to Kanwas timeline items.
 *
 * The Claude Agent SDK streams BetaRawMessageStreamEvent objects via the
 * bridge subprocess. These are the same Anthropic streaming events but
 * received as plain objects (not typed SDK instances).
 *
 * Tracks the state of active content blocks (thinking, text, tool_use)
 * and emits appropriate timeline items and streaming events.
 */
export class ClaudeEventMapper {
  private state: State
  private eventStream: EventStream
  private agent: AgentInfo
  private streaming: StreamingState

  constructor(state: State, eventStream: EventStream, agent: AgentInfo) {
    this.state = state
    this.eventStream = eventStream
    this.agent = agent
    this.streaming = {
      thinkingItemId: null,
      thinkingText: '',
      thinkingStartTime: null,
      chatItemId: null,
      chatText: '',
      hasPersistedChat: false,
      toolItemIds: new Map(),
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Process a raw stream event from the Claude Agent SDK bridge.
   * The event is a BetaRawMessageStreamEvent received as a plain object.
   */
  handleStreamEvent(event: unknown): void {
    if (!event || typeof event !== 'object') return
    const e = event as StreamEvent

    switch (e.type) {
      case 'message_start':
        break

      case 'content_block_start':
        this.handleContentBlockStart(e as ContentBlockStartEvent)
        break

      case 'content_block_delta':
        this.handleContentBlockDelta(e as ContentBlockDeltaEvent)
        break

      case 'content_block_stop':
        // Finalize thinking proactively if active
        break

      case 'message_delta':
        break

      case 'message_stop':
        this.finalize()
        break
    }
  }

  /**
   * Handle a tool_use notification from the bridge.
   * Creates a timeline item for the tool call.
   */
  handleToolUse(toolName: string, toolUseId: string): void {
    this.streaming.toolItemIds.set(toolUseId, toolName)
  }

  /**
   * Finalize any open streaming blocks.
   */
  finalize(): void {
    this.finalizeThinking()
  }

  /**
   * Get accumulated chat text from the current turn.
   */
  getChatText(): string {
    return this.streaming.chatText
  }

  /**
   * Get the reserved chat item ID (if one was created during streaming).
   */
  getChatItemId(): string | undefined {
    return this.streaming.chatItemId || undefined
  }

  /**
   * Whether chat segments were persisted during streaming.
   */
  hasPersistedChatSegments(): boolean {
    return this.streaming.hasPersistedChat
  }

  /**
   * Reset streaming state for a new iteration.
   * Preserves accumulated chat text across iterations.
   */
  resetForNewIteration(): void {
    this.streaming.thinkingItemId = null
    this.streaming.thinkingText = ''
    this.streaming.thinkingStartTime = null
    this.streaming.toolItemIds.clear()
  }

  // --------------------------------------------------------------------------
  // Content Block Handlers
  // --------------------------------------------------------------------------

  private handleContentBlockStart(event: ContentBlockStartEvent): void {
    const block = event.content_block

    switch (block.type) {
      case 'thinking': {
        this.streaming.thinkingStartTime = Date.now()
        this.streaming.thinkingText = block.thinking || ''
        const itemId = this.state.addTimelineItem(
          {
            type: 'thinking',
            thought: this.streaming.thinkingText,
            streaming: true,
            timestamp: Date.now(),
            agent: this.agent,
          },
          'thinking'
        )
        this.streaming.thinkingItemId = itemId
        break
      }

      case 'text': {
        if (!this.streaming.chatItemId) {
          const itemId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
          this.streaming.chatItemId = itemId
        }
        break
      }

      case 'tool_use': {
        if (block.id) {
          this.streaming.toolItemIds.set(block.id, block.name || '')
        }
        break
      }
    }
  }

  private handleContentBlockDelta(event: ContentBlockDeltaEvent): void {
    const delta = event.delta

    switch (delta.type) {
      case 'thinking_delta': {
        this.streaming.thinkingText += delta.thinking || ''
        if (this.streaming.thinkingItemId) {
          this.eventStream.emitEvent({
            type: 'thinking_streaming',
            itemId: this.streaming.thinkingItemId,
            timestamp: Date.now(),
            streamingText: this.streaming.thinkingText,
          })
        }
        break
      }

      case 'text_delta': {
        this.streaming.chatText += delta.text || ''
        if (this.streaming.chatItemId) {
          this.eventStream.emitEvent({
            type: 'chat_streaming',
            itemId: this.streaming.chatItemId,
            timestamp: Date.now(),
            streamingText: this.streaming.chatText,
          })
        }
        break
      }

      case 'input_json_delta': {
        // Tool input is being streamed — handled by tool execution
        break
      }
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private finalizeThinking(): void {
    if (this.streaming.thinkingItemId && this.streaming.thinkingText) {
      const duration = this.streaming.thinkingStartTime ? Date.now() - this.streaming.thinkingStartTime : undefined

      this.state.updateTimelineItem(
        this.streaming.thinkingItemId,
        {
          thought: this.streaming.thinkingText,
          streaming: false,
          duration,
        },
        'thinking'
      )
    }
    this.streaming.thinkingItemId = null
    this.streaming.thinkingText = ''
    this.streaming.thinkingStartTime = null
  }
}
