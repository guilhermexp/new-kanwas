import { describe, expect, it } from 'vitest'
import { DEFAULT_UI_STATE, coerceStoredUIState } from '@/store/useUIStore'

describe('coerceStoredUIState', () => {
  it('defaults follow mode to on for empty and legacy blobs', () => {
    expect(DEFAULT_UI_STATE.agentFollowMode).toBe(true)
    expect(coerceStoredUIState({}).agentFollowMode).toBe(true)
  })

  it('fills missing explorer split state from defaults for legacy blobs', () => {
    const state = coerceStoredUIState({
      sidebarOpen: false,
      zenMode: true,
      fullScreenMode: false,
      sidebarWidth: 240,
      chatWidth: 560,
    })

    expect(state).toEqual({
      ...DEFAULT_UI_STATE,
      sidebarOpen: false,
      zenMode: true,
      sidebarWidth: 240,
      chatWidth: 560,
      agentFollowMode: true,
    })
  })

  it('falls back to defaults for invalid persisted values', () => {
    const state = coerceStoredUIState({
      sidebarOpen: 'yes',
      sidebarWidth: Infinity,
      chatWidth: 'wide',
      explorerSplitPercent: undefined,
      agentFollowMode: 'enabled',
    })

    expect(state).toEqual(DEFAULT_UI_STATE)
  })

  it('reads persisted agent follow mode when enabled', () => {
    const state = coerceStoredUIState({
      agentFollowMode: true,
    })

    expect(state.agentFollowMode).toBe(true)
  })

  it('respects persisted agent follow mode when disabled', () => {
    const state = coerceStoredUIState({
      agentFollowMode: false,
    })

    expect(state.agentFollowMode).toBe(false)
  })
})
