import { test } from '@japa/runner'
import { normalizeLlmDefaultConfigUpdates, resolveEffectiveLlmConfig } from '#services/llm_default_config_service'

test.group('LlmDefaultConfigService', () => {
  test('inherits global OpenAI model when user has no LLM override', ({ assert }) => {
    const config = resolveEffectiveLlmConfig({}, { llmProvider: 'openai', llmModel: 'gpt-5.5' })

    assert.deepEqual(config, {
      llmProvider: 'openai',
      llmModel: 'gpt-5.5',
      reasoningEffort: undefined,
      llmServiceTier: undefined,
    })
  })

  test('keeps per-user model stronger than global model', ({ assert }) => {
    const config = resolveEffectiveLlmConfig(
      { llmProvider: 'openai', llmModel: 'gpt-5.4-mini' },
      { llmProvider: 'openai', llmModel: 'gpt-5.5' }
    )

    assert.deepEqual(config, {
      llmProvider: 'openai',
      llmModel: 'gpt-5.4-mini',
      reasoningEffort: undefined,
      llmServiceTier: undefined,
    })
  })

  test('does not apply OpenAI global model to per-user Anthropic provider', ({ assert }) => {
    const config = resolveEffectiveLlmConfig(
      { llmProvider: 'anthropic' },
      { llmProvider: 'openai', llmModel: 'gpt-5.5' }
    )

    assert.deepEqual(config, {
      llmProvider: 'anthropic',
      llmModel: undefined,
      reasoningEffort: undefined,
      llmServiceTier: undefined,
    })
  })

  test('keeps per-user OpenAI reasoning override with global OpenAI model', ({ assert }) => {
    const config = resolveEffectiveLlmConfig(
      { reasoningEffort: 'high' },
      { llmProvider: 'openai', llmModel: 'gpt-5.5' }
    )

    assert.deepEqual(config, {
      llmProvider: 'openai',
      llmModel: 'gpt-5.5',
      reasoningEffort: 'high',
      llmServiceTier: undefined,
    })
  })

  test('inherits global OpenAI service tier when effective provider is OpenAI', ({ assert }) => {
    const config = resolveEffectiveLlmConfig({}, { llmProvider: 'openai', llmServiceTier: 'priority' })

    assert.deepEqual(config, {
      llmProvider: 'openai',
      llmModel: undefined,
      reasoningEffort: undefined,
      llmServiceTier: 'priority',
    })
  })

  test('does not apply OpenAI service tier to per-user Anthropic provider', ({ assert }) => {
    const config = resolveEffectiveLlmConfig(
      { llmProvider: 'anthropic' },
      { llmProvider: 'openai', llmServiceTier: 'priority' }
    )

    assert.deepEqual(config, {
      llmProvider: 'anthropic',
      llmModel: undefined,
      reasoningEffort: undefined,
      llmServiceTier: undefined,
    })
  })

  test('normalizes default config updates', ({ assert }) => {
    const updates = normalizeLlmDefaultConfigUpdates({
      llmProvider: 'openai',
      llmModel: ' gpt-5.5 ',
      llmServiceTier: ' priority ',
    })

    assert.deepEqual(updates, {
      llmProvider: 'openai',
      llmModel: 'gpt-5.5',
      llmServiceTier: 'priority',
    })
  })

  test('clears default model when default provider changes without a model payload', ({ assert }) => {
    const updates = normalizeLlmDefaultConfigUpdates(
      { llmProvider: 'anthropic' },
      { llmProvider: 'openai', llmModel: 'gpt-5.5', llmServiceTier: 'priority' }
    )

    assert.deepEqual(updates, {
      llmProvider: 'anthropic',
      llmModel: null,
      llmServiceTier: null,
    })
  })

  test('clears default service tier when explicitly blank', ({ assert }) => {
    const updates = normalizeLlmDefaultConfigUpdates({ llmServiceTier: '' }, { llmProvider: 'openai' })

    assert.deepEqual(updates, {
      llmServiceTier: null,
    })
  })

  test('rejects invalid OpenAI service tier', ({ assert }) => {
    assert.throws(
      () => normalizeLlmDefaultConfigUpdates({ llmProvider: 'openai', llmServiceTier: 'fast' }),
      /Invalid OpenAI service tier default/
    )
  })

  test('rejects service tier defaults for Anthropic', ({ assert }) => {
    assert.throws(
      () => normalizeLlmDefaultConfigUpdates({ llmProvider: 'anthropic', llmServiceTier: 'priority' }),
      /Service tier defaults are only supported for OpenAI/
    )
  })

  test('rejects unknown default config fields', ({ assert }) => {
    assert.throws(
      () => normalizeLlmDefaultConfigUpdates({ reasoningEffort: 'high' }),
      /Unsupported LLM default config fields: reasoningEffort/
    )
  })
})
