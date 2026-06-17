# Project Context

## Purpose

Kanwas — multiplayer workspace for AI work. A shared context board where teams and an AI agent collaborate over the same documents, evidence, and decisions, with the agent's tool calls streaming into the same timeline everyone sees. Git-backed markdown filesystem, no vendor lock-in. (OSS, Apache 2.0; upstream `kanwas-ai/kanwas`.)

## Tech Stack

- **Monorepo:** pnpm workspaces (`backend`, `frontend`, `shared`, `execenv`, `yjs-server`, `cli`, `packages/*`). Node + TypeScript throughout. Husky + lint-staged + Prettier.
- **backend:** AdonisJS 6 (`node ace`), Lucid ORM (Postgres), Redis (cache/lock), `@adonisjs/auth`, `@adonisjs/drive` + S3, AI SDK (`@ai-sdk/anthropic`, `@ai-sdk/openai`), `@anthropic-ai/claude-agent-sdk`, BlockNote server-util.
- **frontend:** Vite + React + TypeScript, BlockNote editor (`@blocknote/*`), Excalidraw, dnd-kit, Radix UI, **Tailwind v4** (`@tailwindcss/vite`), TanStack Query. Tests: Vitest + Playwright.
- **yjs-server:** socket.io + Yjs + ywasm, Sentry, pino. Realtime collaboration backend.
- **cli (`@kanwas/cli`):** commander + tsup; Yjs/socket.io-client; workspace ↔ filesystem sync.
- **shared:** common lib (BlockNote, Yjs, valtio-y, remark).
- **execenv (`@kanwas/execenv`):** execution sandbox (chokidar, diff3, ws).

## Project Conventions

### Code Style

- Prettier is the formatter (`pnpm format` at root). ESLint per package (`pnpm --filter <pkg> lint`).
- TypeScript strict; `pnpm --filter <pkg> typecheck` per package.
- Tailwind v4: `@theme inline` + CSS vars, no `tailwind.config.ts`, no `@apply`.
- Never `{count && <Component/>}` — use ternary. No barrel-file imports.

### Architecture

- Server Actions / API endpoints are public: verify auth inside.
- **Yjs/BlockNote is load-bearing.** Clone semantics and transactions matter — read `docs/SYSTEM_OVERVIEW.md` before touching collaborative doc/editor code. `@blocknote/core@0.46.0` is pinned via a patch (`patches/`), with root `pnpm.overrides` for prosemirror-view and blocknote. Do not bump these casually.
- `shared` is imported by backend, yjs-server, cli and execenv — changes there ripple; treat as a contract.

### Testing Strategy

- backend: `node ace test` (suites: `unit`, `functional`, `agent`).
- frontend: Vitest (`pnpm --filter frontend test`) + Playwright (`test:smoke`, `test:workspace`, `test:e2e`).
- shared / yjs-server / execenv: Vitest.
- Real validation before "done": run the app (`docker-compose --profile app up` → http://localhost:5173) and observe the feature in the browser.

### Git Workflow

- Default branch: `master`. Work on the current branch; do not auto-create branches.
- `pnpm format` + relevant package lint before any PR. First-time external contributors sign the CLA (`.github/CLA.md`).

## Domain Context

Core entities: workspaces (boards), documents (markdown, BlockNote), canvas nodes (incl. video/task/checklist nodes), the AI agent timeline. The CLI mirrors a workspace to local `.md` files (`kanwas pull`/`push`/`import`) bound via `.kanwas.json`.

## Important Constraints

- Requires Anthropic and/or OpenAI API keys + Postgres + Redis to run.
- Env split across root `.env` + per-workspace `.env` (backend, yjs-server, frontend).
- Deploy references Railway (`backend/scripts/railway/`).

## External Dependencies

Anthropic API, OpenAI API, Postgres, Redis, S3-compatible object storage, E2B (execution environment), Sentry (yjs-server/execenv).
