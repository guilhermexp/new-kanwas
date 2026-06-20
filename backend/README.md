# Kanwas API

Backend API for Kanwas built with AdonisJS 6.

## Development

### Setup

Install dependencies

```bash
npm install
```

Copy `.env` file

```bash
cp .env.example .env
```

Run docker-compose

```bash
docker-compose up postgres redis
```

Run migrations:

```bash
node ace migration:run
```

Start development server:

```bash
node ace serve
```

Run tests:

```bash
node ace test
```

### Agent execution engines

The agent loop runs on one of three engines, selected with `EXECUTION_ENGINE`
(`vercel-ai` default, `claude-sdk`, `codex`). The CLI engines authenticate with
subscriptions rather than API keys: `claude-sdk` uses the local Claude Code
login, while `codex` uses the per-user OpenAI device OAuth connection from the
app. Both require `SANDBOX_PROVIDER=host` so the CLI can run against a real host
workspace:

```bash
cd backend && pnpm dev   # Postgres/Redis/yjs can stay in Docker
```

Restart after changing `EXECUTION_ENGINE` / `CLAUDE_SDK_MODEL` / `CODEX_*` — HMR
does not reload env. Full reference (auth, env vars, gotchas):
[../docs/EXECUTION_ENGINES.md](../docs/EXECUTION_ENGINES.md).

### API Documentation

Swagger UI is available at `http://localhost:3333/api` when the server is running.

### Type-Safe API Client (Tuyau)

This project uses [Tuyau](https://tuyau.julr.dev) to generate type-safe API clients for frontend consumption.

**Important:** After making changes to routes, controllers, or adding validators, you must regenerate the API types:

```bash
node ace tuyau:generate
```

## Organization + invite onboarding model

- Access is enforced by organization membership roles (`admin`, `member`), not workspace owners.
- New registration without invite creates a personal organization and an initial workspace.
- Login/register with `inviteToken` joins the invited organization and returns `workspaceId` for redirect.
- Google OAuth invite handoff uses server-stored one-time `state` (short TTL) and validates it on callback.
- Invite links are open-join, single-use tokens with a default 30-day TTL.

### New organization/invite endpoints

- `GET /workspaces/:id/organization` - get current workspace organization details.
- `PATCH /workspaces/:id/organization` - rename organization (admin only).
- `GET /workspaces/:id/invites` - list organization invites (admin only).
- `POST /workspaces/:id/invites` - create invite link (admin only).
- `POST /workspaces/:id/invites/:inviteId/revoke` - revoke invite (admin only).
- `POST /invites/accept` - accept invite token as authenticated user.
