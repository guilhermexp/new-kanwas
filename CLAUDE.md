# Kanwas — Claude Code guide

Multiplayer workspace for AI work (canvas + agent over shared docs). pnpm monorepo, TypeScript. See `AGENTS.md` (navigation/edit map) and `openspec/project.md` (spec authoring + conventions) — this file is the quick operational summary.

## Contracts (read first)
- **OpenSpec** (`openspec/`) — eixo TEMPO: create a change before new capability / breaking / behavior change. Gate: `openspec validate <id> --strict --no-interactive`.
- **DOX** (`AGENTS.md` hierárquico) — eixo ESPAÇO: read the AGENTS.md chain root→target before editing; DOX pass before done.

## Layout
`backend/` (AdonisJS API + AI agent) · `frontend/` (Vite+React canvas/editor) · `yjs-server/` (realtime Yjs) · `cli/` (`@kanwas/cli` FS sync) · `shared/` (common lib — contract) · `execenv/` (exec sandbox).

## Commands
- Install: `pnpm install` (Node + pnpm)
- Dev (per pkg): `pnpm --filter <pkg> dev` · Full stack: `docker-compose --profile app up` → http://localhost:5173
- Format: `pnpm format` · Lint/typecheck: `pnpm --filter <pkg> lint|typecheck`
- Backend: `node ace migration:run` (migrate), `node ace test` (suites: unit/functional/agent)
- Frontend tests: `pnpm --filter frontend test` (vitest), `test:smoke`/`test:workspace`/`test:e2e` (Playwright)

## Env
Root `.env` + per-workspace `.env` (backend, yjs-server, frontend). Needs Anthropic and/or OpenAI key + Postgres + Redis. Templates: `*/.env.example`.

## Lessons Learned
- **Yjs/BlockNote**: clone semantics + transactions are subtle — read `docs/SYSTEM_OVERVIEW.md` before touching collaborative editor/doc code. `@blocknote/core@0.46.0` is patched (`patches/`) with root `pnpm.overrides`; do not bump casually.
- Tailwind v4: `@theme inline` + CSS vars, no `tailwind.config`, no `@apply`.
- `shared/` changes ripple to 4 consumers — treat as a contract.
- Work on `master` (default); do not auto-create branches.
