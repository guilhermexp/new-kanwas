import { describe, expect, it } from 'vitest'
import {
  EXECUTION_ENGINE_PRESETS,
  getExecutionEnginePreset,
  isExecutionEngine,
  isExecutionEnginePresetId,
} from '../../src/execution-config'

describe('execution config presets', () => {
  it('keeps Claude Code Opus and Fable as separate presets on the same runtime engine', () => {
    const opus = getExecutionEnginePreset('claude-sdk')
    const fable = getExecutionEnginePreset('claude-sdk-fable-5-1m')

    expect(opus).toMatchObject({
      id: 'claude-sdk',
      engine: 'claude-sdk',
      model: 'claude-opus-4-8',
    })
    expect(fable).toMatchObject({
      id: 'claude-sdk-fable-5-1m',
      engine: 'claude-sdk',
      model: 'claude-fable-5',
    })
  })

  it('treats the Fable option as a preset id, not a standalone execution engine', () => {
    expect(isExecutionEnginePresetId('claude-sdk-fable-5-1m')).toBe(true)
    expect(isExecutionEngine('claude-sdk-fable-5-1m')).toBe(false)
  })

  it('does not reuse preset ids', () => {
    const ids = EXECUTION_ENGINE_PRESETS.map((preset) => preset.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})
