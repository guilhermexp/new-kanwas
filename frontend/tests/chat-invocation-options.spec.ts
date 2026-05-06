import { describe, expect, it } from 'vitest'
import type { AgentMode } from 'backend/agent'
import {
  createAgentInvocationUiOptions,
  createOnboardingAgentInvocationUiOptions,
  getAgentFollowModeButtonCopy,
  getActiveAgentInvocationUiOptions,
  getDisplayedAgentFollowMode,
  getInvocationUiOptionsForLaunch,
  normalizeAgentInvocationUiOptions,
  setActiveAgentInvocationFollow,
  setActiveAgentInvocationMode,
  type AgentInvocationUiOptions,
} from '@/providers/chat/invocationOptions'

function state(
  overrides: {
    invocationId?: string | null
    agentMode?: AgentMode
    activeInvocationOptions?: AgentInvocationUiOptions | null
  } = {}
) {
  return {
    invocationId: overrides.invocationId ?? 'invocation-1',
    agentMode: overrides.agentMode ?? 'direct',
    activeInvocationOptions: overrides.activeInvocationOptions ?? null,
  }
}

describe('agent invocation UI options', () => {
  it('creates normal invocation options from defaults', () => {
    expect(createAgentInvocationUiOptions('thinking', true)).toEqual({
      mode: 'thinking',
      follow: true,
    })
  })

  it('creates onboarding options without changing normal launch defaults', () => {
    const onboardingOptions = createOnboardingAgentInvocationUiOptions()

    expect(onboardingOptions).toEqual({
      mode: 'thinking',
      follow: true,
    })

    expect(
      getInvocationUiOptionsForLaunch({
        isContinuation: false,
        activeInvocationOptions: onboardingOptions,
        agentMode: 'direct',
        defaultFollowMode: true,
      })
    ).toEqual({
      mode: 'direct',
      follow: true,
    })

    expect(
      getInvocationUiOptionsForLaunch({
        isContinuation: false,
        activeInvocationOptions: onboardingOptions,
        agentMode: 'direct',
        defaultFollowMode: false,
      })
    ).toEqual({
      mode: 'direct',
      follow: false,
    })
  })

  it('falls back to direct mode and follow false for legacy active invocation state', () => {
    expect(
      getActiveAgentInvocationUiOptions({
        activeInvocationOptions: null,
        agentMode: 'direct',
      })
    ).toEqual({
      mode: 'direct',
      follow: false,
    })
  })

  it('rejects invalid persisted active invocation options', () => {
    expect(normalizeAgentInvocationUiOptions({ mode: 'thinking', follow: 'yes' })).toBeNull()
    expect(normalizeAgentInvocationUiOptions({ mode: 'invalid', follow: true })).toEqual({
      mode: 'thinking',
      follow: true,
    })
  })

  it('uses active invocation follow before the persisted default', () => {
    expect(
      getDisplayedAgentFollowMode({
        invocationId: 'invocation-1',
        activeInvocationOptions: {
          mode: 'thinking',
          follow: true,
        },
        defaultFollowMode: false,
      })
    ).toBe(true)

    expect(
      getDisplayedAgentFollowMode({
        invocationId: null,
        activeInvocationOptions: {
          mode: 'thinking',
          follow: false,
        },
        defaultFollowMode: true,
      })
    ).toBe(true)
  })

  it('keeps task-live follow on for continuations until disabled', () => {
    const current = state({
      activeInvocationOptions: {
        mode: 'thinking',
        follow: true,
      },
    })

    expect(
      getInvocationUiOptionsForLaunch({
        isContinuation: true,
        activeInvocationOptions: current.activeInvocationOptions,
        agentMode: current.agentMode,
        defaultFollowMode: false,
      })
    ).toEqual({
      mode: 'thinking',
      follow: true,
    })

    setActiveAgentInvocationFollow(current, false)

    expect(
      getInvocationUiOptionsForLaunch({
        isContinuation: true,
        activeInvocationOptions: current.activeInvocationOptions,
        agentMode: current.agentMode,
        defaultFollowMode: true,
      })
    ).toEqual({
      mode: 'thinking',
      follow: false,
    })
  })

  it('falls back to follow false for legacy continuations without active options', () => {
    expect(
      getInvocationUiOptionsForLaunch({
        isContinuation: true,
        activeInvocationOptions: null,
        agentMode: 'thinking',
        defaultFollowMode: true,
      })
    ).toEqual({
      mode: 'thinking',
      follow: false,
    })
  })

  it('describes whether follow is enabled', () => {
    expect(
      getAgentFollowModeButtonCopy({
        invocationId: 'invocation-1',
        enabled: true,
      })
    ).toEqual({
      ariaLabel: 'Disable agent follow',
      title: 'Click to disable agent follow',
    })

    expect(
      getAgentFollowModeButtonCopy({
        invocationId: 'invocation-1',
        enabled: false,
      })
    ).toEqual({
      ariaLabel: 'Enable agent follow',
      title: 'Click to enable agent follow',
    })

    expect(
      getAgentFollowModeButtonCopy({
        invocationId: null,
        enabled: true,
      })
    ).toEqual({
      ariaLabel: 'Disable agent follow',
      title: 'Click to disable agent follow',
    })

    expect(
      getAgentFollowModeButtonCopy({
        invocationId: null,
        enabled: false,
      })
    ).toEqual({
      ariaLabel: 'Enable agent follow',
      title: 'Click to enable agent follow',
    })
  })

  it('updates active invocation mode while preserving follow', () => {
    const current = state({
      agentMode: 'direct',
      activeInvocationOptions: {
        mode: 'direct',
        follow: true,
      },
    })

    setActiveAgentInvocationMode(current, 'thinking')

    expect(current.agentMode).toBe('thinking')
    expect(current.activeInvocationOptions).toEqual({
      mode: 'thinking',
      follow: true,
    })
  })

  it('updates active invocation follow without mutating mode', () => {
    const current = state({
      activeInvocationOptions: {
        mode: 'thinking',
        follow: true,
      },
    })

    setActiveAgentInvocationFollow(current, false)

    expect(current.activeInvocationOptions).toEqual({
      mode: 'thinking',
      follow: false,
    })
  })
})
