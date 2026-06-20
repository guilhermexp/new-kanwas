# Kanwas Backend DOX

## Purpose

AdonisJS 6 API for Kanwas product state, auth, organizations, workspace CRUD, files, document shares, tasks, integrations, and AI agent invocation orchestration. It also owns the Socket.IO event fanout used by the frontend and the backend side of sandbox/Yjs coordination.

## Ownership

- `app/controllers/` owns HTTP route handlers registered in `start/routes.ts`.
- `app/models/` and `database/migrations/` own Lucid persistence schema.
- `app/services/` owns application services for workspaces, files, document shares, org usage, Composio, LLM defaults, sandbox access, and Yjs server integration.
- `libs/agent/` owns the agent runtime, tool loop, provider bridges, subagents, sandbox adapters, prompts, tracing, and public agent types.
- `commands/` owns Ace console commands; Adonis package commands are registered in `adonisrc.ts`.
- `start/` owns env validation, middleware/kernel, events, scheduler, and routes.

## Local Contracts

- Public workspace exports are declared in `package.json#exports`. Frontend and other packages import `backend/api`, `backend/socketio`, selected models, selected services, and `backend/agent`; keep those paths stable or update all consumers.
- `backend/api.ts` re-exports generated Tuyau route metadata from `.adonisjs/api.js`. After route/controller/validator changes, run `pnpm --filter backend codegen`.
- `start/routes.ts` is the route contract. Check auth, organization access, sandbox token scope, and API key groups before adding or moving endpoints.
- `/auth/default` and the development default-token middleware are local-dev conveniences only; keep them disabled unless `DEFAULT_USER_LOGIN_ENABLED=true` is explicitly set, and never let the dev fallback override an explicit `Authorization` header.
- `app/controllers/yjs_socket_tokens_controller.ts`, `app/services/yjs_socket_token_service.ts`, and the token-scoped routes coordinate with `yjs-server`, `frontend`, `cli`, and `execenv`.
- `libs/agent/public_types.d.ts` is the cross-package agent timeline/type contract. Agent event names and item shapes are rendered by the frontend timeline.
- `PostHogService` runtime analytics has been removed. Do not reintroduce a container-bound analytics service, model wrapper, AI span emitter, workspace-view listener, or user-identify call without a new OpenSpec change; the separate `PostHogUsageQueryService` for organization usage remains allowed.
- Codex OAuth credentials are **per user**, never instance-global. The path scheme lives in `app/services/codex_home.ts` (`resolveUserCodexHome(userId)` → `<base>/<userId>`); both `CodexOauthService` (writes/reads/refreshes via the `codex-auth` routes, scoped by `auth.getUserOrFail().id`) and `CodexProcessManager` (agent runtime, via `CodexEngine` using `traceIdentity.distinctId`) must derive the home from that helper. The runtime must NOT seed a user home from the host's `~/.codex/auth.json`; a user only has a credential after completing the OpenAI device OAuth flow. Keep Codex auth semantics aligned with Pi where applicable: handle `slow_down`, token expiry/refresh, and ChatGPT `accountId` extraction without introducing API-key auth or shared credentials.
- `libs/agent/prompts/**/*.md` and `libs/agent/bridge/**/*.mjs` are Adonis meta files copied during build; keep runtime assets under configured meta paths or update `adonisrc.ts`.
- Workspace/document code touches Yjs/BlockNote semantics indirectly through `shared`. Read `docs/SYSTEM_OVERVIEW.md` before changing collaborative document, note, or workspace sync behavior.

## Work Guidance

- Dev: `pnpm --filter backend dev`
- Build: `pnpm --filter backend build`
- Start built server: `pnpm --filter backend start`
- Test default suites: `pnpm --filter backend test`
- Agent tests: `pnpm --filter backend test:agent`
- Lint: `pnpm --filter backend lint`
- Format this package: `pnpm --filter backend format`
- Typecheck: `pnpm --filter backend typecheck`
- Migrate: `pnpm --filter backend migrate`
- Generate API metadata: `pnpm --filter backend codegen`
- Railway env helper: `pnpm --filter backend set-env-var`

## Verification

- Unit and functional coverage: `pnpm --filter backend test`
- Agent runtime coverage: `pnpm --filter backend test:agent`
- Static checks: `pnpm --filter backend lint` and `pnpm --filter backend typecheck`
- Route/type contract check after API changes: `pnpm --filter backend codegen`

## Child DOX Index

No nested `AGENTS.md` yet.
