import type { ApplicationService } from '@adonisjs/core/types'
import { HttpContext } from '@adonisjs/core/http'

import { CanvasAgent } from '#agent/index'
import { ContextualLoggerContract } from '#contracts/contextual_logger'
import { ContextualLogger } from '#services/contextual_logger'
import { SandboxRegistry } from '#services/sandbox_registry'
import PostHogService from '#services/posthog_service'
import { createProviderFromConfig } from '#agent/providers/index'
import type { ProviderConfig } from '#agent/providers/index'
import { ANTHROPIC_DEFAULT_MODEL_TIERS, ANTHROPIC_DEFAULT_SUBAGENT_MODEL_TIERS } from 'shared/llm-config'

function createAnthropicStubProvider(): ProviderConfig {
  return {
    name: 'anthropic',
    createModel() {
      throw new Error('LLM provider not available — using external engine')
    },
    generationOptions() {
      return {}
    },
    promptOptions() {
      return {}
    },
    formatMessages(m) {
      return m
    },
    supportsThinking: true,
    supportsCaching: false,
    supportsNativeTools: true,
    modelTiers: ANTHROPIC_DEFAULT_MODEL_TIERS,
    subagentModelTiers: ANTHROPIC_DEFAULT_SUBAGENT_MODEL_TIERS,
  }
}

export default class AppProvider {
  constructor(protected app: ApplicationService) {}

  /**
   * Register bindings to the container
   */
  register() {
    this.app.container.singleton(PostHogService, () => new PostHogService())

    // Register ContextualLoggerContract with fallback for non-HTTP contexts.
    // For HTTP requests, container_bindings_middleware provides a request-scoped binding
    // that overrides this. For background tasks/events, this fallback is used.
    this.app.container.bind(ContextualLoggerContract, async () => {
      try {
        // Try to get from current HTTP context (works if useAsyncLocalStorage is enabled)
        const ctx = HttpContext.getOrFail()
        return new ContextualLogger(ctx.logger, {
          correlationId: ctx.correlationId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        })
      } catch {
        // Fallback for background tasks without HTTP context
        return ContextualLogger.createFallback()
      }
    })

    this.app.container.bind(CanvasAgent, async (resolver) => {
      const { default: WorkspaceDocumentService } = await import('#services/workspace_document_service')
      const { default: WebSearchService } = await import('#services/web_search_service')

      const configService = await resolver.make('config')
      const config = configService.get<any>('agent')
      const workspaceDocumentService = await resolver.make(WorkspaceDocumentService)
      const webSearchService = WebSearchService.create()
      const sandboxRegistry = await resolver.make(SandboxRegistry)
      const posthogService = await resolver.make(PostHogService)
      const logger = await resolver.make(ContextualLoggerContract)

      // Request-scoped defaults are resolved after reading user/admin config from DB.
      // When using claude-sdk or codex engine, LLM provider is optional (they use CLI subscriptions).
      let provider: ReturnType<typeof createProviderFromConfig>
      try {
        provider = createProviderFromConfig(config, {}, { logger })
      } catch {
        if (config.executionEngine === 'vercel-ai' || !config.executionEngine) {
          throw new Error('Missing LLM API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.')
        }
        // Stub provider for non-vercel-ai engines — tools/sandbox still work, LLM calls go through the bridge
        provider = createAnthropicStubProvider()
      }

      return new CanvasAgent({
        provider,
        model: provider.modelTiers.big,
        executionEngine: config.executionEngine,
        workspaceDocumentService,
        webSearchService,
        sandboxRegistry,
        posthogService,
      })
    })
  }

  /**
   * The container bindings have booted
   */
  async boot() {}

  /**
   * The application has been booted
   */
  async start() {}

  /**
   * The process has been started
   */
  async ready() {}

  /**
   * Preparing to shutdown the app
   */
  async shutdown() {
    const posthogService = await this.app.container.make(PostHogService)
    await posthogService.shutdown()
  }
}
