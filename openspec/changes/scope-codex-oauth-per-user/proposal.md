# Scope Codex OAuth credentials per user

## Why

The Codex OAuth feature (device-code login that lets the Codex `app-server`
engine authenticate with a ChatGPT/OpenAI account) currently stores **one
credential per backend instance** at `~/.kanwas/codex-home/auth.json`
(`CodexOauthService`) and the agent runtime (`CodexProcessManager`) reads that
same global path. Because the backend hosts **multiple organizations/users in a
single process**, this means:

- Any authenticated user (not just an admin) can connect their OpenAI account,
  and every other user in any org then runs the Codex engine on **that** shared
  credential and quota.
- Any user can `DELETE /codex-auth` and wipe the credential everyone depends on
  (denial of service).
- The agent runtime additionally seeds the isolated `CODEX_HOME` from the
  **host's** `~/.codex/auth.json`, leaking the operator's personal Codex login
  to every tenant.

The product decision is to make the Codex connection **per user**: each user
connects their own OpenAI account, and an agent invocation runs under the
credential of the user who owns that invocation — matching how the neighbouring
global route `user-config` already scopes everything by `user.id`.

This change also folds in the correctness/robustness findings surfaced during
review (non-atomic credential write, frontend polling that never expires, a
re-render that resets the poll timer, missing `noopener` on one link) and the
Pi-alignment follow-up: handle device-code `slow_down`, persist token expiry and
ChatGPT account id, and refresh expired Codex credentials before reporting a user
as connected.

## What Changes

- **BREAKING (pre-release feature, not yet shipped):** Codex credentials move
  from a single instance-global file to a **per-user** location keyed by
  `user.id`. `CodexOauthService` becomes per-user; the controller passes the
  authenticated `user.id`.
- The in-memory device-login session map is **scoped per user**, so a session
  started by user A cannot be polled/observed by user B.
- The agent runtime (`CodexEngine` → `CodexProcessManager`) resolves the
  `CODEX_HOME` of the **invoking user** instead of the global default.
- **Remove host-credential seeding**: the process manager no longer copies the
  host's `~/.codex/auth.json` into the per-user home. A user only has a Codex
  credential if they completed the OAuth device flow.
- Credential file writes become **atomic** (`renameSync` of a temp file) and
  per-user auth writes/refreshes are serialized inside the backend process.
- Codex OAuth token handling mirrors Pi's device-code path where applicable for
  Kanwas' web app: `slow_down` remains pending with a longer interval, token
  expiry is recorded, `accountId` is extracted from the access token when needed,
  and expired credentials refresh through OpenAI before status reports connected.
- Frontend: poll loop honours `expiresAt` and stops with a clear error; the
  refresh callback is memoised; the second "reopen verification page" link gets
  `noopener,noreferrer`.
- App auth default-user fallback is now explicitly opt-in on both backend and
  frontend, and development middleware preserves explicit bearer tokens, so
  two-user Codex isolation can be validated without the app silently collapsing
  sessions into the local default user.

## Impact

- Affected specs: `codex-oauth` (new capability).
- Affected code:
  - `backend/app/services/codex_oauth_service.ts` (per-user paths + sessions + atomic write)
  - `backend/app/controllers/codex_auth_controller.ts` (pass `user.id`)
  - `backend/start/routes.ts` (unchanged routing; behaviour now per-user)
  - `backend/libs/agent/bridge/codex_engine.ts` (propagate invoking user)
  - `backend/libs/agent/bridge/codex_process_manager.ts` (per-user `CODEX_HOME`, drop host seeding)
  - `frontend/src/components/workspaces/team-settings/AgentEngineSection.tsx`
  - `backend/app/controllers/auth_controller.ts`, `backend/app/middleware/auth_middleware.ts`,
    `frontend/src/providers/auth/AuthProvider.tsx` (default-user auth opt-in for real multi-user validation)
  - tests: `backend/tests/unit/services/codex_oauth_service.spec.ts`,
    `backend/tests/unit/agent/codex_home_seeding.spec.ts`
- After backend route/controller changes run `pnpm --filter backend codegen`.
- No data migration: the feature is unreleased, so any existing
  `~/.kanwas/codex-home/auth.json` can be left as-is (it simply stops being read).
