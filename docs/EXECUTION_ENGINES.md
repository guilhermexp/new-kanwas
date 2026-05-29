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

> **Convention:** the `claude-sdk` and `codex` engines authenticate with the
> **logged-in CLI subscription on the host**, not an API key. They are the
> supported way to run the agent against a developer's Claude/Codex
> subscription. Do not reintroduce API-key auth into these engines.

## Running the CLI engines: host or Docker

`claude-sdk` and `codex` spawn local CLI processes that need (a) the CLI binary
and (b) the subscription login. Both run modes are supported:

### On the host

`cd backend && pnpm dev`. The binaries (`claude` via the SDK, `codex` on PATH)
and logins (`~/.claude`, `~/.codex`) are already present. Postgres/Redis/yjs can
stay in Docker — their ports are exposed and `backend/.env` points at them
(`localhost:5433`, etc.).

### In Docker (backend container)

`backend/Dockerfile.dev` installs `@openai/codex` and the Linux `claude` binary
ships with `@anthropic-ai/claude-agent-sdk`, so both CLIs are in the image. The
host logins are mounted as volumes in `docker-compose.yml` (stopgap until
UI-driven auth exists):

```yaml
volumes:
  - ${HOME}/.codex:/root/.codex:ro
  - ${HOME}/.claude:/root/.claude
```

The container also builds `execenv`, which the host sandbox spawns.

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

`codex_process_manager.ts` seeds an **isolated `CODEX_HOME`**
(`~/.kanwas/codex-home` by default) with a copy of the host's
`~/.codex/auth.json`, then points `codex app-server` at it via `CODEX_HOME`.
This mirrors the OpenClicky approach: Codex authenticates with the existing CLI
login (ChatGPT subscription) **without mutating the user's real `~/.codex`**
(history, config, sessions stay untouched).

Credential files are written owner-only: the directory is `0700` and the copied
`auth.json` is `0600`. The seed is skipped if an `auth.json` already exists in
the isolated home.

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
- `backend/tests/unit/agent/codex_home_seeding.spec.ts` — isolated `CODEX_HOME`
  seeding and `0700`/`0600` permissions.
