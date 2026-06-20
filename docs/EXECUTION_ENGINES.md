# Agent Execution Engines

The agent loop can be driven by one of three interchangeable **execution engines**.
The engine is selected per environment via the `EXECUTION_ENGINE` variable and
resolved by `shared/src/execution-config.ts`.

| Engine     | `EXECUTION_ENGINE` | LLM auth                               | Where the loop runs            |
| ---------- | ------------------ | -------------------------------------- | ------------------------------ |
| Vercel AI  | `vercel-ai`        | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | In-process (default)           |
| Claude SDK | `claude-sdk`       | **Claude Code subscription**           | `claude_bridge.mjs` subprocess |
| Codex      | `codex`            | **Codex (ChatGPT) subscription**       | `codex app-server` subprocess  |

`vercel-ai` is the fallback when `EXECUTION_ENGINE` is unset or invalid.

## Selecting the engine

Two levels, in precedence order:

1. **Per-user (UI)** — Team settings → **Agent** section. The user picks a preset
   (Codex / Claude Code / Built-in); the choice persists in their user config
   (`executionEngine`) and is applied at invocation by `start_agent.ts`,
   overriding the env. Presets live in `shared/execution-config.ts`
   (`EXECUTION_ENGINE_PRESETS`) and also carry the model the engine should use
   (e.g. Claude Code → `claude-opus-4-8`, Claude Code Fable →
   `claude-fable-5`). The chat header badge reflects the selected engine's
   model.
2. **Env default** — `EXECUTION_ENGINE` is used for users with no per-user
   choice.

> The agent's self-reported model (when asked "what model are you?") is not
> reliable — LLMs don't reliably know their own version. The source of truth is
> the `Applied user execution engine` log line and the model id sent to the API.

> **Convention:** the `claude-sdk` and `codex` engines authenticate with user
> subscriptions, not API keys. `claude-sdk` uses the host's Claude Code login;
> `codex` uses Kanwas' per-user OpenAI device OAuth flow and stores the
> resulting credential under that user's isolated `CODEX_HOME`. Do not
> reintroduce API-key auth or instance-global Codex credentials into these
> engines.

## Running the CLI engines: host or Docker

`claude-sdk` and `codex` spawn local CLI processes that need the CLI binary and
subscription credentials. For Claude Code the credential is the host/container
Claude login; for Codex each Kanwas user connects their own ChatGPT/Codex
subscription through the app. Both run modes are supported:

### On the host

`cd backend && pnpm dev`. The binaries (`claude` via the SDK, `codex` on PATH)
are available on the host. Claude Code uses the host's `~/.claude` login. Codex
uses the per-user credential created from Team settings → Agent → Codex →
Connect account, stored by default under `~/.kanwas/codex-home/<userId>/`.
Postgres/Redis/yjs can stay in Docker — their ports are exposed and
`backend/.env` points at them (`localhost:5433`, etc.).

### In Docker (backend container)

`backend/Dockerfile.dev` installs `@openai/codex` and the Linux `claude` binary
ships with `@anthropic-ai/claude-agent-sdk`, so both CLIs are in the image.
`docker-compose.yml` mounts the host's `~/.claude` for Claude Code and persists
Kanwas' per-user Codex home in a named volume:

```yaml
volumes:
  - ${HOME}/.claude:/root/.claude
  - kanwas_codex_home:/root/.kanwas/codex-home
```

Do **not** mount `${HOME}/.codex` into the backend container. Codex credentials
are created per Kanwas user by the app's OpenAI device OAuth flow; copying the
operator's host `~/.codex/auth.json` would leak one person's subscription across
users. The container also builds `execenv`, which the host sandbox spawns.

`SANDBOX_PROVIDER=host` is required for both CLI engines so the sandbox cwd is a
real path (the container itself, in Docker mode).

## Environment variables

```dotenv
# Engine selection
EXECUTION_ENGINE=claude-sdk        # vercel-ai (default) | claude-sdk | codex
SANDBOX_PROVIDER=host              # required for claude-sdk and codex

# claude-sdk
CLAUDE_SDK_MODEL=claude-sonnet-4-6 # forces a Claude model (see gotcha below)
CLAUDE_CODE_EXECUTABLE=claude      # optional; resolved on PATH otherwise

# codex
CODEX_EXECUTABLE=codex             # optional; resolved on PATH otherwise
CODEX_MODEL=                       # optional; unset uses Codex CLI default
CODEX_HOME=                        # optional; defaults to ~/.kanwas/codex-home
```

## How each CLI engine grabs the subscription token

### claude-sdk

`claude_bridge.mjs` runs `@anthropic-ai/claude-agent-sdk`, which uses the Claude
Code subscription login. A stray `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in
the environment would override the subscription and force (often invalid)
API-key auth, so the bridge **strips those vars** before the SDK runs
(`sanitizeBridgeEnv` in `backend/libs/agent/bridge/claude_bridge_auth.mjs`).

### codex

Kanwas owns the Codex connection through authenticated `codex-auth` routes. The
OAuth semantics intentionally mirror Pi's Codex subscription login where that
fits a web app, while keeping Kanwas' current `codex app-server` runtime:

1. The user selects Codex in Team settings and clicks **Connect account**.
2. `CodexOauthService.startDeviceLogin()` requests a device code from OpenAI and
   returns `https://auth.openai.com/codex/device` plus the user code.
3. The frontend polls `codex-auth/:sessionId`; pending authorization remains
   pending, `slow_down` increases the poll interval, and expiry stops polling
   with a clear error.
4. When OpenAI authorizes the device code, the backend exchanges the
   authorization code for tokens, extracts the ChatGPT `accountId` from the
   access-token claims when OpenAI does not return it directly, and records the
   token expiry.
5. The backend writes `<CODEX_HOME base>/<userId>/auth.json` with
   `auth_mode: "chatgpt"` and owner-only permissions (`0700` directory, `0600`
   file). Expired credentials are refreshed from the stored refresh token before
   status reports `connected: true`.
6. `CodexEngine` starts `codex app-server` with `CODEX_HOME` pointing at the
   invoking user's directory, so the runtime can only use that user's own
   credential.

The default base is `~/.kanwas/codex-home`; `CODEX_HOME` overrides that base.
The app-server never seeds a user home from the host's `~/.codex/auth.json`, and
there is no shared instance-global Codex fallback. Kanwas does not use Pi's
localhost browser-callback flow because that flow is designed for a local CLI;
the device-code path is the Pi-equivalent flow that works for web/server
sessions.

## Gotchas

- **Model mismatch (claude-sdk):** the workspace model selector can be a GPT id
  (e.g. "gpt-5.5"). The claude-sdk engine forwards `flow.main.model` to the
  Claude SDK, which rejects non-Claude models with a 404. Set
  `CLAUDE_SDK_MODEL=claude-sonnet-4-6` to force a valid Claude model regardless
  of the UI selection. Codex is unaffected — it uses `CODEX_MODEL` or its own
  default, never the workspace GPT id.
- **Swallowed SDK errors:** when a turn fails the SDK often reports
  `subtype: "success"` with the real reason in `result` (e.g. "Invalid API
  key"). `resolveSdkErrorMessage` surfaces that instead of a generic message.
- **claude-sdk as root (Docker):** Claude Code refuses
  `--dangerously-skip-permissions` (used by the bridge's bypass mode) when
  running as root unless `IS_SANDBOX=1` is set. `sanitizeBridgeEnv` sets it, so
  the engine works in the root backend container; without it the claude process
  exits with code 1.
- **Restart on `.env` change:** HMR does not reload env vars. Changing
  `EXECUTION_ENGINE` / `CLAUDE_SDK_MODEL` / `CODEX_*` requires a backend restart.
- **One server only:** killing just the `:3333` listener leaves the
  `pnpm dev` / `ace serve --hmr` supervisor alive, which can pile up orphan
  servers. Kill the whole process tree when restarting.

## Tests

- `backend/tests/unit/agent/execution_config.spec.ts` — engine resolution.
- `backend/tests/unit/agent/claude_bridge_auth.spec.ts` — API-key stripping and
  SDK error-message resolution.
- `backend/tests/unit/services/codex_oauth_service.spec.ts` — device OAuth
  start/poll/token exchange, per-user `auth.json`, isolation, and permissions.
- `backend/tests/unit/agent/codex_home_seeding.spec.ts` — per-user `CODEX_HOME`
  preparation without host credential seeding.
