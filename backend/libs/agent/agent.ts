import { EventStream } from './events.js'
import { SerializedState, State } from './state.js'
import type { AgentConfig, Context } from './types.js'
import type { ToolContext } from './tools/context.js'
import { LLM, type NativeGenerateResult } from './llm.js'
import type { SandboxManager } from './sandbox/index.js'
import type { ModelMessage } from 'ai'
import {
  buildTraceIdentity,
  createRootTraceContext,
  isAbortError,
  type TraceContext,
  type TraceIdentity,
} from './tracing/trace_context.js'
import {
  createOnboardingFlowDefinition,
  createProductAgentFlowDefinition,
  resolveProductAgentFlow,
  type ProductAgentFlowDefinition,
  type ResolvedProductAgentFlow,
} from './flow.js'
import type { ProviderConfig } from './providers/types.js'
import { buildContextSection, buildWorkingContextCanvasPath } from './execution_context.js'
import { buildUserMessageContent, refreshPersistedAttachmentUrls } from './user_message_content.js'
import { promptManager } from './prompt_manager.js'
import { buildMessagesHash } from './messages_hash.js'
import { normalizeAgentMode } from './modes.js'
import SkillService from '#services/skill_service'
import UserConfigService from '#services/user_config_service'
import { type ExecutionEngine, DEFAULT_EXECUTION_ENGINE } from 'shared/execution-config'
import { CodexEngine } from './bridge/codex_engine.js'
import { ClaudeSDKEngine } from './bridge/claude_sdk_engine.js'

export interface AgentExecuteOptions {
  allowTerminalToolCompletion?: boolean
  resumeFromState?: boolean
}

type ReplayTraceProperties = {
  parent_messages_hash: string
  replayed_messages_hash: string
  replay_hash_match: boolean
}

export class CanvasAgent {
  private llm: LLM
  protected eventStream: EventStream
  private state: State
  private provider: ProviderConfig
  private executionEngine: ExecutionEngine
  private workspaceDocumentService: AgentConfig['workspaceDocumentService']
  private webSearchService: AgentConfig['webSearchService']
  private sandboxRegistry: AgentConfig['sandboxRegistry']
  private sandboxManager: SandboxManager
  private codexEngine: CodexEngine | null = null
  private claudeSDKEngine: ClaudeSDKEngine | null = null
  private engineModelOverride: string | undefined
  private replayTraceProperties: ReplayTraceProperties | undefined

  constructor(config: AgentConfig) {
    this.eventStream = new EventStream()
    this.state = new State(this.eventStream)
    this.provider = config.provider
    this.executionEngine = config.executionEngine ?? DEFAULT_EXECUTION_ENGINE
    this.llm = new LLM({ provider: config.provider, model: config.model })
    this.state.setProvider(config.provider.name)
    this.workspaceDocumentService = config.workspaceDocumentService
    this.webSearchService = config.webSearchService
    this.sandboxRegistry = config.sandboxRegistry
    // SandboxManager will be set in execute() from invocation registry
    this.sandboxManager = null as unknown as SandboxManager
  }
  /**
   * Override the provider and model for this agent instance.
   * Called from start_agent.ts when user has a per-user llmProvider config.
   */
  overrideProvider(provider: ProviderConfig) {
    this.provider = provider
    this.llm = new LLM({ provider, model: provider.modelTiers.big })
    this.state.setProvider(provider.name)
  }

  /**
   * Override the execution engine (and optionally the model the CLI engine
   * should use) for this agent instance. Called from start_agent.ts when the
   * user picked an engine in settings, overriding the EXECUTION_ENGINE env.
   */
  overrideExecutionEngine(engine: ExecutionEngine, model?: string | null) {
    this.executionEngine = engine
    this.engineModelOverride = model ?? undefined
  }

  loadState(state: SerializedState) {
    this.state = State.fromJSON(state)
    const parentMessages = state.messages || state.anthropicMessages || []
    const parentMessagesHash = buildMessagesHash(parentMessages)
    const replayedMessagesHash = buildMessagesHash(this.state.getMessages())

    this.replayTraceProperties = {
      parent_messages_hash: parentMessagesHash,
      replayed_messages_hash: replayedMessagesHash,
      replay_hash_match: parentMessagesHash === replayedMessagesHash,
    }

    this.reinitializeWithState()
  }

  async refreshPersistedAttachmentUrls(
    options: {
      logger?: { warn: (ctx: Record<string, unknown>, msg: string) => void }
    } = {}
  ): Promise<boolean> {
    const current = this.state.getMessages()
    if (current.length === 0) return false

    const result = await refreshPersistedAttachmentUrls(current, { logger: options.logger })
    if (result.changed) {
      this.state.replaceMessages(result.messages)
    }
    return result.changed
  }

  private reinitializeWithState() {
    this.eventStream = new EventStream()
    this.state.setEventStream(this.eventStream)
  }

  getEventStream(): EventStream {
    return this.eventStream
  }

  static getProductAgentFlowDefinition(model: string, provider: ProviderConfig): ProductAgentFlowDefinition {
    return createProductAgentFlowDefinition(model, provider)
  }

  static getOnboardingFlowDefinition(model: string, provider: ProviderConfig): ProductAgentFlowDefinition {
    return createOnboardingFlowDefinition(model, provider)
  }

  static getInvocationFlowDefinition(input: {
    model: string
    provider: ProviderConfig
    invocationSource: string | null
  }): ProductAgentFlowDefinition {
    return input.invocationSource === 'onboarding'
      ? CanvasAgent.getOnboardingFlowDefinition(input.model, input.provider)
      : CanvasAgent.getProductAgentFlowDefinition(input.model, input.provider)
  }

  static resolveInvocationFlow(input: {
    definition: ProductAgentFlowDefinition
    mainSystemPrompts: string[]
    subagentPromptByName: Record<string, string | string[]>
    provider?: ProviderConfig
  }): ResolvedProductAgentFlow {
    return resolveProductAgentFlow(input)
  }

  async resolveFlow(context: Context): Promise<ResolvedProductAgentFlow> {
    this.state.currentContext = context

    const definition = CanvasAgent.getInvocationFlowDefinition({
      model: this.llm.getModelName(),
      provider: this.provider,
      invocationSource: context.invocationSource,
    })
    const mainSystemPrompts = await this.buildSystemPrompts(definition)
    const subagentPromptByName: Record<string, string> = {}

    // Load dismissed tip IDs from global user config
    try {
      const userConfigService = new UserConfigService()
      const globalConfig = await userConfigService.getConfig(context.userId)
      context.dismissedTipIds = globalConfig.dismissedTipIds
    } catch {
      // Non-critical — tips will show even if already dismissed
    }

    for (const subagent of definition.subagents) {
      subagentPromptByName[subagent.name] = promptManager.getPrompt(
        `agents/${subagent.promptFile}`,
        {},
        this.provider.name
      )
    }

    return CanvasAgent.resolveInvocationFlow({
      definition,
      mainSystemPrompts,
      subagentPromptByName,
      provider: this.provider,
    })
  }

  async execute(
    userMessage: string,
    context: Context,
    flow?: ResolvedProductAgentFlow,
    _sessionId?: string,
    options: AgentExecuteOptions = {}
  ): Promise<NativeGenerateResult | null> {
    // Create abort controller for this execution
    this.state.createAbortController()
    // Ensure context is always available for timeline/tracing paths.
    this.state.currentContext = context
    this.state.setProvider(this.provider.name)
    // Reset sandbox manager for this run (important if agent instance is reused).
    this.sandboxManager = null as unknown as SandboxManager

    const traceIdentity = buildTraceIdentity(context)
    const traceContext = createRootTraceContext(context.invocationId, context.aiSessionId)
    const replayTraceProperties = this.consumeReplayTraceProperties()

    let traceError: string | undefined
    let traceOutput: unknown

    const cancelReason = 'User interrupted execution'

    const markCancelled = () => {
      this.state.failActiveToolItems('Execution stopped by user')
      this.state.addTimelineItem(
        {
          type: 'execution_completed',
          summary: 'Execution stopped by user',
          timestamp: Date.now(),
        },
        'execution_interrupted'
      )

      traceOutput = {
        status: 'cancelled',
        reason: cancelReason,
        iterations: 0,
      }
    }

    try {
      if (this.state.isAborted) {
        markCancelled()
        return null
      }

      const resolvedFlow = flow || (await this.resolveFlow(context))

      if (this.state.isAborted) {
        markCancelled()
        return null
      }

      try {
        const sandboxManager = await this.sandboxRegistry.createInvocationSandbox({
          invocationId: context.invocationId,
          workspaceId: context.workspaceId,
          userId: context.userId,
          authToken: context.authToken,
          authTokenId: context.authTokenId,
          correlationId: context.correlationId,
        })
        this.sandboxManager = sandboxManager

        if (!options.resumeFromState) {
          // Add user message to timeline
          this.state.addTimelineItem(
            {
              type: 'user_message',
              message: userMessage,
              timestamp: Date.now(),
              invocationId: context.invocationId,
              uploadedFiles: context.uploadedFiles || undefined,
            },
            'user_message'
          )

          // Build context section (workspace structure, active canvas, selections)
          const contextSection = buildContextSection(context)

          // Emit working context event early so user sees it immediately
          this.emitWorkingContext()

          // Build user message content (multimodal if files are attached).
          const userMessageContent = await buildUserMessageContent({
            context,
            userMessage,
            contextSection,
          })

          // Add user message to conversation history ONCE at the start
          this.state.addMessage({ role: 'user', content: userMessageContent })
        }

        if (this.state.isAborted) {
          markCancelled()
          return null
        }

        const result = await this.generateActionAndObservation(
          resolvedFlow,
          this.state.abortSignal,
          traceContext,
          traceIdentity,
          replayTraceProperties
        )

        const isQuestionHandoff = result.toolResults.some((toolResult) => toolResult.toolName === 'ask_question')
        if (isQuestionHandoff) {
          traceOutput = {
            status: 'waiting_for_user',
            toolResults: result.toolResults,
          }
          return result
        }

        const hasToolOnlyCompletion =
          options.allowTerminalToolCompletion === true &&
          !!resolvedFlow.main.terminalToolName &&
          result.toolResults.some((toolResult) => toolResult.toolName === resolvedFlow.main.terminalToolName)
        const hasAssistantOutput = result.hasPersistedChatOutput === true || !!result.textOutput

        if (!hasAssistantOutput && !hasToolOnlyCompletion && result.iterations >= resolvedFlow.main.maxIterations) {
          this.state.addTimelineItem(
            {
              type: 'error',
              error: {
                code: 'MAX_ITERATIONS',
                message: `Agent reached maximum iteration limit of ${resolvedFlow.main.maxIterations}`,
                timestamp: Date.now(),
              },
              timestamp: Date.now(),
            },
            'error'
          )
          throw new Error(`Agent reached maximum iteration limit of ${resolvedFlow.main.maxIterations}`)
        }

        const finalOutputText = result.textOutput
        if (!hasAssistantOutput && !hasToolOnlyCompletion) {
          throw new Error('Agent completed without a final assistant message')
        }

        if (finalOutputText) {
          this.state.addTimelineItem(
            {
              type: 'chat',
              message: finalOutputText,
              timestamp: Date.now(),
            },
            'chat',
            result.textOutputItemId
          )

          traceOutput = [{ role: 'assistant', content: finalOutputText }]
        } else if (result.hasPersistedChatOutput === true) {
          traceOutput = {
            status: 'completed',
            assistantOutputPersistedDuringExecution: true,
            toolResults: result.toolResults,
          }
        } else {
          traceOutput = {
            status: 'completed',
            toolResults: result.toolResults,
          }
        }

        // Emit completion event
        this.state.addTimelineItem(
          {
            type: 'execution_completed',
            summary: 'Completed',
            timestamp: Date.now(),
          },
          'execution_completed'
        )

        return result
      } catch (error) {
        if (this.state.isAborted || isAbortError(error)) {
          traceOutput = {
            status: 'cancelled',
            reason: cancelReason,
          }
        } else {
          traceError = error instanceof Error ? error.message : 'Unknown error'
          traceOutput = {
            status: 'error',
            error: traceError,
          }
        }

        throw error
      }
    } catch (error) {
      // Handle abort gracefully - this is an intentional user interruption
      // Check both the abort signal state AND error name since SDK may wrap the AbortError
      if (this.state.isAborted || isAbortError(error)) {
        traceOutput = traceOutput || {
          status: 'cancelled',
          reason: cancelReason,
        }

        this.state.failActiveToolItems('Execution stopped by user')

        // Add execution stopped event if not already added
        this.state.addTimelineItem(
          {
            type: 'execution_completed',
            summary: 'Execution stopped by user',
            timestamp: Date.now(),
          },
          'execution_interrupted'
        )

        // Exit cleanly without throwing
        return null
      }

      traceError = error instanceof Error ? error.message : 'Unknown error occurred'
      traceOutput = traceOutput || {
        status: 'error',
        error: traceError,
      }

      // Add error to timeline
      this.state.addTimelineItem(
        {
          type: 'error',
          error: {
            code: 'EXECUTION_ERROR',
            message: traceError,
            details: error,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        },
        'error'
      )
      throw error
    } finally {
      // Clean up LLM resources (e.g., Composio sessions)
      await this.llm.closeSession()

      // Clean up Codex engine if used
      if (this.codexEngine) {
        await this.codexEngine.shutdown()
        this.codexEngine = null
      }

      // Clean up Claude SDK engine if used
      if (this.claudeSDKEngine) {
        await this.claudeSDKEngine.shutdown()
        this.claudeSDKEngine = null
      }
    }
  }

  /**
   * Emit working context event to show user what documents agent will work with
   */
  private emitWorkingContext(): void {
    const context = this.state.currentContext
    const canvasPath = buildWorkingContextCanvasPath(context)

    // Add working context to timeline
    this.state.addTimelineItem(
      {
        type: 'working_context',
        canvasId: context.canvasId,
        canvasPath,
        workspaceId: context.workspaceId,
        timestamp: Date.now(),
      },
      'working_context'
    )
  }

  /**
   * Build ordered system prompt blocks for the main agent.
   */
  private async buildSystemPrompts(definition: ProductAgentFlowDefinition): Promise<string[]> {
    const [basePromptName, ...additionalPromptNames] = definition.mainPromptNames
    const blocks: string[] = []

    if (basePromptName) {
      blocks.push(promptManager.getPrompt(basePromptName, {}, this.provider.name))
      const agentMode = normalizeAgentMode(this.state.currentContext.agentMode)
      blocks.push(promptManager.getPrompt(`default_${agentMode}`, {}, 'openai'))
    }

    blocks.push(
      ...additionalPromptNames.map((promptName) => promptManager.getPrompt(promptName, {}, this.provider.name))
    )

    // Append skill descriptions to system prompt (Claude Code pattern)
    const userId = this.state.currentContext.userId
    const skillService = new SkillService()
    const skillSection = await skillService.getSkillDescriptionsForPrompt(userId)

    if (skillSection) {
      blocks.push(skillSection)
    }

    return blocks
  }

  /**
   * Run the main product-agent ToolLoop using the resolved invocation flow.
   *
   * Dispatches to the configured execution engine:
   * - `vercel-ai`: Vercel AI SDK (default)
   * - `claude-sdk`: Anthropic Messages API direct (with tool loop)
   * - `codex`: Codex CLI subprocess
   */
  private async generateActionAndObservation(
    flow: ResolvedProductAgentFlow,
    abortSignal: AbortSignal | undefined,
    traceContext: TraceContext,
    traceIdentity: TraceIdentity,
    traceProperties?: ReplayTraceProperties
  ): Promise<NativeGenerateResult> {
    switch (this.executionEngine) {
      case 'vercel-ai':
        break // fall through to existing implementation
      case 'claude-sdk':
        return this.generateViaClaudeSDK(flow, abortSignal, traceContext, traceIdentity)
      case 'codex':
        return this.generateViaCodex(flow, abortSignal, traceContext, traceIdentity, traceProperties)
      default:
        throw new Error(`Unknown execution engine: ${this.executionEngine}`)
    }

    // Build tool context for tool execution (captured via closure in tool adapter)
    const toolContext: ToolContext = {
      state: this.state,
      llm: this.llm,
      eventStream: this.eventStream,
      workspaceDocumentService: this.workspaceDocumentService,
      webSearchService: this.webSearchService,
      sandboxManager: this.sandboxManager,
      agent: { source: 'main' },
      flow,
      traceContext,
      traceIdentity,
      providerName: this.provider.name,
      supportsNativeTools: this.provider.supportsNativeTools,
      userId: this.state.currentContext.userId,
      abortSignal,
    }

    // Get conversation messages in native Anthropic format
    // The state stores messages in a format compatible with both SDKs
    const messages = this.state.getMessages()

    // Call LLM with tools
    const result: NativeGenerateResult = await this.llm.generateWithTools({
      messages,
      systemPrompts: flow.main.systemPrompts,
      stopWhen: flow.main.stopWhen,
      providerOptions: flow.main.providerOptions,
      context: toolContext,
      traceProperties,
      abortSignal,
    })

    // Store all messages from the response
    // Native SDK returns messages in Anthropic format
    for (const msg of result.messages) {
      this.state.addMessage(msg as ModelMessage)
    }

    return result
  }

  // ============================================================================
  // Claude SDK Engine
  // ============================================================================

  /**
   * Run the agent loop using the Claude Agent SDK (subscription auth).
   *
   * The Claude Agent SDK authenticates via the user's Claude Code subscription
   * (Claude Pro/Max) — no API key needed. It spawns a Claude Code session that
   * handles the entire tool loop internally (bash, file editing, etc.).
   *
   * We bridge via a subprocess (claude_bridge.mjs) that communicates over
   * NDJSON stdin/stdout and map streaming events to Kanwas timeline items.
   */
  private async generateViaClaudeSDK(
    flow: ResolvedProductAgentFlow,
    abortSignal: AbortSignal | undefined,
    traceContext: TraceContext,
    traceIdentity: TraceIdentity
  ): Promise<NativeGenerateResult> {
    if (!this.claudeSDKEngine) {
      this.claudeSDKEngine = new ClaudeSDKEngine({
        model: this.engineModelOverride || process.env.CLAUDE_SDK_MODEL || flow.main.model || undefined,
        maxTurns: flow.main.maxIterations,
      })
    }

    // Build tool context (passed through but tools are managed by Claude Code)
    const toolContext: ToolContext = {
      state: this.state,
      llm: this.llm,
      eventStream: this.eventStream,
      workspaceDocumentService: this.workspaceDocumentService,
      webSearchService: this.webSearchService,
      sandboxManager: this.sandboxManager,
      agent: { source: 'main' },
      flow,
      traceContext,
      traceIdentity,
      providerName: 'anthropic',
      supportsNativeTools: true,
      userId: this.state.currentContext.userId,
      abortSignal,
    }

    const result = await this.claudeSDKEngine.execute(
      {
        flow,
        abortSignal,
        traceContext,
        traceIdentity,
      },
      this.state,
      this.eventStream,
      this.sandboxManager,
      toolContext
    )

    // Claude Agent SDK manages its own conversation; messages are empty
    // but we still process any that were returned
    for (const msg of result.messages) {
      this.state.addMessage(msg as ModelMessage)
    }

    return result
  }

  // ============================================================================
  // Codex Engine
  // ============================================================================

  private async generateViaCodex(
    flow: ResolvedProductAgentFlow,
    abortSignal: AbortSignal | undefined,
    traceContext: TraceContext,
    traceIdentity: TraceIdentity,
    traceProperties?: ReplayTraceProperties
  ): Promise<NativeGenerateResult> {
    if (!this.codexEngine) {
      this.codexEngine = new CodexEngine({
        executable: process.env.CODEX_EXECUTABLE || 'codex',
        model: this.engineModelOverride || process.env.CODEX_MODEL || undefined,
      })
    }

    return this.codexEngine.execute(
      {
        flow,
        abortSignal,
        traceContext,
        traceIdentity,
        traceProperties,
      },
      this.state,
      this.eventStream,
      this.sandboxManager
    )
  }

  // ============================================================================
  // State Management
  // ============================================================================

  getState(): State {
    return this.state
  }

  setState(state: State): void {
    this.state = state
    this.replayTraceProperties = undefined
    this.reinitializeWithState()
  }

  private consumeReplayTraceProperties(): ReplayTraceProperties | undefined {
    const properties = this.replayTraceProperties
    this.replayTraceProperties = undefined
    return properties
  }
}
