# Tasks

- [x] Delete `PostHogService`, its unit spec, and the workspace-view listener.
- [x] Remove container binding, shutdown hook, and agent/background service injection.
- [x] Remove AI span/model-wrapper/tool-cost PostHog calls from agent runtime.
- [x] Rename generic trace context helpers from `tracing/posthog` to `tracing/trace_context`.
- [x] Update focused tests and mocks to no longer provide `posthogService`.
- [x] Validate with backend typecheck, lint, and focused unit tests.
