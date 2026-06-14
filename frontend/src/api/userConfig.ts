import type { LlmProviderName } from 'shared/llm-config'
import { ANTHROPIC_DEFAULT_MODEL_TIERS, DEFAULT_LLM_PROVIDER, OPENAI_DEFAULT_MODEL_TIERS } from 'shared/llm-config'
import type { ExecutionEnginePresetId } from 'shared/execution-config'
import { getExecutionEnginePreset } from 'shared/execution-config'

import { tuyau } from './client'

import type { AppLanguage } from '@/i18n'

export interface UserConfig {
  dismissedTipIds?: string[]
  llmProvider?: LlmProviderName | null
  llmModel?: string | null
  executionEngine?: ExecutionEnginePresetId | null
  language?: AppLanguage | null
}

export interface UserConfigUpdate {
  dismissedTipIds?: string[]
  executionEngine?: ExecutionEnginePresetId | null
  language?: AppLanguage | null
}

export const DEFAULT_USER_LLM_HEADER_LABEL = getUserLlmHeaderLabel()

export function getUserLlmHeaderLabel(
  config?: Pick<UserConfig, 'llmProvider' | 'llmModel' | 'executionEngine'>
): string {
  // A selected CLI engine (Codex / Claude Code) determines the model shown,
  // overriding the provider/model label used by the built-in (vercel-ai) engine.
  const preset = getExecutionEnginePreset(config?.executionEngine)

  if (preset?.engine === 'codex') {
    return 'GPT 5.5'
  }
  if (preset?.engine === 'claude-sdk') {
    return formatAnthropicModelLabel(preset?.model ?? '')
  }

  const provider = config?.llmProvider ?? DEFAULT_LLM_PROVIDER
  const model = config?.llmModel || getDefaultModel(provider)

  if (provider === 'openai') {
    return formatOpenAIModelLabel(model)
  }

  return formatAnthropicModelLabel(model)
}

export const getUserConfig = async (): Promise<{ config: UserConfig }> => {
  const response = await tuyau['user-config'].$get()
  if (response.error) {
    throw response.error
  }
  return response.data as { config: UserConfig }
}

export const updateUserConfig = async (updates: UserConfigUpdate): Promise<{ config: UserConfig }> => {
  const response = await tuyau['user-config'].$patch(updates)
  if (response.error) {
    throw response.error
  }
  return response.data as { config: UserConfig }
}

function getDefaultModel(provider: LlmProviderName): string {
  return provider === 'openai' ? OPENAI_DEFAULT_MODEL_TIERS.big : ANTHROPIC_DEFAULT_MODEL_TIERS.big
}

function formatOpenAIModelLabel(model: string): string {
  const normalized = model.toLowerCase()
  if (normalized.startsWith('gpt-5.5')) return 'GPT 5.5'
  if (normalized.startsWith('gpt-5.4')) return 'GPT 5.4'
  if (normalized.startsWith('gpt-5')) return 'GPT 5'
  return model
}

function formatAnthropicModelLabel(model: string): string {
  const normalized = model.toLowerCase()
  if (normalized.includes('fable-5')) return 'Fable 5 1M'
  if (normalized.includes('opus-4-8')) return 'Opus 4.8'
  if (normalized.includes('opus-4-6')) return 'Opus 4.6'
  if (normalized.includes('sonnet-4-6')) return 'Sonnet 4.6'
  if (normalized.includes('haiku-4-5')) return 'Haiku 4.5'
  return model
}
