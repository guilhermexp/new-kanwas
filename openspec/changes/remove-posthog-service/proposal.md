# Remove PostHogService runtime analytics

## Why

`PostHogService` was a no-op runtime analytics service that still remained wired
through the backend container, agent runtime, workspace-view listener, and tests.
It added dead dependencies and caused failing expectations around analytics calls.

## What Changes

- Remove `backend/app/services/posthog_service.ts` completely.
- Remove the workspace-view PostHog listener and its event registration.
- Remove PostHog analytics dependencies from `CanvasAgent`, `LLM`, subagent/tool
  loop execution, and background agent preparation.
- Keep organization usage querying (`PostHogUsageQueryService`) intact because it
  is a separate billing/usage query integration, not `PostHogService` runtime
  analytics.
- Rename generic agent trace context helpers away from PostHog naming.

## Impact

- No runtime PostHog analytics events, spans, model wrappers, or user identify
  calls are emitted.
- Agent execution, timeline updates, OpenAI lane headers, and organization usage
  queries continue to work without `PostHogService`.
