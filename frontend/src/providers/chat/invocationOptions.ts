import type { AgentMode } from 'backend/agent'

export interface AgentInvocationUiOptions {
  mode: AgentMode
  follow: boolean
}

export const DEFAULT_AGENT_MODE: AgentMode = 'thinking'

export function normalizeChatAgentMode(mode: unknown): AgentMode {
  return mode === 'thinking' || mode === 'direct' ? mode : DEFAULT_AGENT_MODE
}

export function createAgentInvocationUiOptions(mode: unknown, follow: boolean): AgentInvocationUiOptions {
  return {
    mode: normalizeChatAgentMode(mode),
    follow,
  }
}

export function createOnboardingAgentInvocationUiOptions(): AgentInvocationUiOptions {
  return createAgentInvocationUiOptions('thinking', true)
}

export function normalizeAgentInvocationUiOptions(value: unknown): AgentInvocationUiOptions | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const options = value as Partial<AgentInvocationUiOptions>
  if (typeof options.follow !== 'boolean') {
    return null
  }

  return createAgentInvocationUiOptions(options.mode, options.follow)
}

export function getActiveAgentInvocationUiOptions(options: {
  activeInvocationOptions?: AgentInvocationUiOptions | null
  agentMode: AgentMode
}): AgentInvocationUiOptions {
  return (
    normalizeAgentInvocationUiOptions(options.activeInvocationOptions) ??
    createAgentInvocationUiOptions(options.agentMode, false)
  )
}

export function getDisplayedAgentFollowMode(options: {
  invocationId?: string | null
  activeInvocationOptions?: AgentInvocationUiOptions | null
  defaultFollowMode: boolean
}): boolean {
  if (!options.invocationId) {
    return options.defaultFollowMode
  }

  return options.activeInvocationOptions?.follow === true
}

export function getInvocationUiOptionsForLaunch(options: {
  isContinuation: boolean
  activeInvocationOptions?: AgentInvocationUiOptions | null
  agentMode: AgentMode
  defaultFollowMode: boolean
}): AgentInvocationUiOptions {
  if (options.isContinuation) {
    return getActiveAgentInvocationUiOptions({
      activeInvocationOptions: options.activeInvocationOptions,
      agentMode: options.agentMode,
    })
  }

  return createAgentInvocationUiOptions(options.agentMode, options.defaultFollowMode)
}

export function getAgentFollowModeButtonCopy(options: { invocationId?: string | null; enabled: boolean }): {
  ariaLabel: string
  title: string
} {
  return {
    ariaLabel: options.enabled ? 'Disable agent follow' : 'Enable agent follow',
    title: options.enabled ? 'Click to disable agent follow' : 'Click to enable agent follow',
  }
}

export function setActiveAgentInvocationMode(
  state: {
    invocationId: string | null
    agentMode: AgentMode
    activeInvocationOptions?: AgentInvocationUiOptions | null
  },
  mode: AgentMode
) {
  state.agentMode = mode

  if (!state.invocationId) {
    return
  }

  const activeOptions = getActiveAgentInvocationUiOptions(state)
  state.activeInvocationOptions = {
    ...activeOptions,
    mode,
  }
}

export function setActiveAgentInvocationFollow(
  state: {
    invocationId: string | null
    agentMode: AgentMode
    activeInvocationOptions?: AgentInvocationUiOptions | null
  },
  follow: boolean
) {
  if (!state.invocationId) {
    return
  }

  const activeOptions = getActiveAgentInvocationUiOptions(state)
  state.activeInvocationOptions = {
    ...activeOptions,
    follow,
  }
}
