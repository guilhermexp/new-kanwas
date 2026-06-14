import type { OrganizationRole } from '#models/organization_membership'
import type { DateTime } from 'luxon'

type Timestamp = DateTime | null | undefined

export interface WorkspaceViewedTrackingPayload {
  correlationId: string
  user: {
    id: string
    email: string
    name: string
    createdAt: Timestamp
    updatedAt: Timestamp
  }
  workspace: {
    id: string
    name: string
    createdAt: Timestamp
    updatedAt: Timestamp
  }
  organization: {
    id: string
    name: string
    createdAt: Timestamp
    updatedAt: Timestamp
  }
  organizationRole: OrganizationRole
}

export interface IdentifyUserPayload {
  id: string
  email?: string | null
  name?: string | null
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export interface AiEventIdentity {
  distinctId: string
  workspaceId: string
  organizationId: string
  invocationId: string
  correlationId: string
}

export interface AiEventLinkage {
  traceId: string
  sessionId: string
  parentId?: string
}

export interface AiModelTracingOptions extends AiEventIdentity, AiEventLinkage {
  properties?: Record<string, unknown>
  privacyMode?: boolean
}

export interface AiTraceEventPayload extends AiEventIdentity {
  traceId: string
  sessionId: string
  traceName: string
  status: 'started' | 'completed' | 'failed' | 'cancelled'
  input?: unknown
  output?: unknown
  isError?: boolean
  error?: string
  properties?: Record<string, unknown>
}

export interface AiSpanEventPayload extends AiEventIdentity, AiEventLinkage {
  spanId: string
  spanName: string
  status: 'started' | 'completed' | 'failed' | 'cancelled'
  input?: unknown
  output?: unknown
  isError?: boolean
  error?: string
  properties?: Record<string, unknown>
}

export interface AiGenerationEventPayload extends AiEventIdentity, AiEventLinkage {
  model: string
  provider: string
  generationId?: string
  input?: unknown
  output?: unknown
  latencySeconds?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number
  isError?: boolean
  error?: string
  properties?: Record<string, unknown>
}

export default class PostHogService {
  identifyUser(
    _payload: IdentifyUserPayload,
    _options: {
      set?: Record<string, unknown>
      setOnce?: Record<string, unknown>
    } = {}
  ): void {
    return
  }

  trackWorkspaceViewed(_payload: WorkspaceViewedTrackingPayload): void {
    return
  }

  wrapModelWithTracing<TModel>(model: TModel, _options: AiModelTracingOptions): TModel {
    return model
  }

  captureAiTrace(_payload: AiTraceEventPayload): void {
    return
  }

  captureAiSpan(_payload: AiSpanEventPayload): void {
    return
  }

  captureAiGeneration(_payload: AiGenerationEventPayload): void {
    return
  }

  async shutdown(): Promise<void> {
    return
  }
}
