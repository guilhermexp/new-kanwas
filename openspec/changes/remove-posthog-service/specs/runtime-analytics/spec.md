# runtime-analytics

## ADDED Requirements

### Requirement: No PostHogService runtime analytics

The backend SHALL NOT define, bind, inject, or call a `PostHogService` runtime
analytics service.

#### Scenario: Backend boots without PostHogService

- **WHEN** the backend application provider registers container bindings
- **THEN** it does not bind `PostHogService`
- **AND** shutdown does not attempt to resolve or flush `PostHogService`

#### Scenario: Agent runtime does not require analytics service

- **WHEN** `CanvasAgent`, `LLM`, subagents, tools, or background agent execution
  are constructed
- **THEN** they do not require a `posthogService` dependency
- **AND** they do not emit PostHog spans, traces, generation events, workspace
  view events, or user identify calls

### Requirement: PostHog usage query integration remains separate

The backend SHALL keep the separate `PostHogUsageQueryService` available for
organization usage and billing queries.

#### Scenario: Organization usage queries are not runtime analytics

- **WHEN** runtime `PostHogService` analytics are removed
- **THEN** `PostHogUsageQueryService` remains available for organization usage
  calculations
