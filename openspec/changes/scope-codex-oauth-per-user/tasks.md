# Tasks

## 1. Backend — per-user credential storage & sessions

- [x] 1.1 In `codex_oauth_service.ts`, derive the credential directory from a
      `userId` (e.g. `~/.kanwas/codex-home/<userId>`); make `getStatus`,
      `startDeviceLogin`, `pollDeviceLogin`, `disconnect` operate per user.
- [x] 1.2 Scope the device-login session map per user (key includes `userId`);
      reject polling a session that does not belong to the caller; clean up and
      surface an expiry error when `expiresAtMs` has passed.
- [x] 1.3 Make `writeCodexAuth` atomic: write temp file (`0o600`) then
      `renameSync(tempPath, authPath)`; drop the `rmSync`+`writeFileSync(readFileSync(...))`+`rmSync` dance.
- [x] 1.4 In `codex_auth_controller.ts`, pass `auth.getUserOrFail().id` into the
      service for every action.
- [x] 1.5 Update/extend `backend/tests/unit/services/codex_oauth_service.spec.ts`
      to cover per-user isolation, cross-user poll rejection, expiry, and atomic write.
- [x] 1.6 Align the device-code flow with Pi semantics where applicable: handle
      `slow_down`, persist token expiry/account id, refresh expired credentials,
      and serialize per-user auth writes.

## 2. Backend — agent runtime per-user CODEX_HOME

- [x] 2.1 Trace how the invoking user reaches `CodexEngine.execute`
      (`ExecutionBridgeInput`/`State`); thread the `userId` through.
- [x] 2.2 Resolve the per-user `CODEX_HOME` (same scheme as 1.1) when
      constructing `CodexProcessManager`; no global fallback.
- [x] 2.3 Remove host-credential seeding from `prepareCodexHome` (do not copy
      `~/.codex/auth.json`); a user only has a credential if they ran the device flow.
- [x] 2.4 Update `backend/tests/unit/agent/codex_home_seeding.spec.ts` to reflect
      no-seeding + per-user home behaviour.

## 3. Frontend — polling robustness

- [x] 3.1 In `AgentEngineSection.tsx`, stop the poll loop when `Date.now()`
      passes the session expiry; show an expiry error (new i18n key
      `settings.codexAuthExpired` in `en.json` + `pt.json`).
- [x] 3.2 Memoise the refresh callback with `useCallback` so the poll `useEffect`
      is not torn down on parent re-renders.
- [x] 3.3 Add `noopener,noreferrer` to the "reopen verification page" link.
- [x] 3.4 Let backend `slow_down` responses update the frontend polling interval.

## 4. Verification

- [x] 4.1 `pnpm --filter backend test` (unit + functional) green (per-user codex
      specs pass; the only failures are pre-existing `WorkspaceSuggestedTaskGenerationService`
      cases that require `SANDBOX_PROVIDER=host`, unchanged from baseline).
- [x] 4.2 `pnpm --filter backend codegen` after route/controller changes.
- [x] 4.3 `pnpm --filter backend typecheck` + `pnpm --filter frontend typecheck` green.
- [x] 4.4 DOX pass: update `backend/AGENTS.md` (and root if needed) if the
      route/credential contract changed.
- [ ] 4.5 Real validation: open the Agent engine settings in the browser,
      connect Codex as one user, confirm a second user sees `connected: false`.
      (Deferred to the orchestrator — requires a running stack + two user sessions.)

## 5. App auth — real multi-user validation support

- [x] 5.1 Gate `/auth/default` behind explicit `DEFAULT_USER_LOGIN_ENABLED=true`.
- [x] 5.2 Keep frontend default-user auto-login/logout fallback opt-in via
      `VITE_DEFAULT_AUTH_ENABLED=true`, paired with the backend flag.
- [x] 5.3 Preserve explicit `Authorization` headers in development so one
      session's bearer token is not overwritten by the default-user fallback.
