# Kanwas Execenv DOX

## Purpose

`@kanwas/execenv` is the sandbox-side sync process. It connects an execution filesystem to a Kanwas workspace, hydrates files from Yjs, watches local changes, applies them back to the canonical workspace state, exposes a local live-state HTTP API, and keeps canvas metadata files in sync.

## Ownership

- `src/index.ts` owns environment configuration, startup, Yjs sync manager initialization, live-state server startup, file watchers, Sentry, and shutdown.
- `src/sync-manager.ts` owns workspace hydration, bidirectional filesystem sync, markdown preflight/merge, binary upload/download, metadata refresh, section operations, actor identity caching, and Yjs connection lifecycle.
- `src/watcher.ts` owns chokidar-based file watching, serialized event handling, and rename detection.
- `src/filesystem.ts` owns filesystem writes/reads, traversal guards, binary reads, ready marker, and `metadata.yaml` parsing/writing.
- `src/live-state-server.ts` owns localhost HTTP endpoints for section/file-anchor queries and section changes.
- `src/metadata-manager.ts` owns rewriting `metadata.yaml` from canonical Yjs state.
- `src/api.ts` owns backend fetches for signed URLs, uploads, members, current user, and Yjs socket tokens.

## Local Contracts

- Required runtime env: `WORKSPACE_ID`, `YJS_SERVER_HOST`, `BACKEND_URL`, `AUTH_TOKEN`, and `USER_ID`. Optional env includes `WORKSPACE_PATH`, `YJS_SERVER_PROTOCOL`, `LOG_LEVEL`, `PRETTY_LOGS`, `CORRELATION_ID`, and `SENTRY_DSN`.
- The process connects as a workspace client through `shared/connectToWorkspace` and obtains a Yjs socket token from backend before connecting.
- Markdown and YAML files are watched without write-settle delay; other files use the settled watcher. Both watcher streams serialize handlers to avoid metadata and Yjs races.
- Local filesystem writes must stay under `WORKSPACE_PATH`; `filesystem.ts` contains path traversal guards.
- Markdown conflict handling uses `mergeMarkdown3Way(base, incoming, current)` before applying local edits to canonical state.
- `LiveStateServer` listens on port `43127` by default and exposes POST-only section/file-anchor operations for agent workflows.
- `metadata.yaml` is generated from canonical canvas state. Treat it as a projection, not the source of truth.
- Sync depends on `shared/server` `workspaceToFilesystem`, `FilesystemSyncer`, `ContentConverter`, and binary file type contracts.

## Work Guidance

- Dev/watch TypeScript: `pnpm --filter @kanwas/execenv dev`
- Build: `pnpm --filter @kanwas/execenv build`
- Start built process: `pnpm --filter @kanwas/execenv start`
- Typecheck: `pnpm --filter @kanwas/execenv typecheck`
- Tests: `pnpm --filter @kanwas/execenv test`
- Watch tests: `pnpm --filter @kanwas/execenv test:watch`

## Verification

- Unit/integration coverage: `pnpm --filter @kanwas/execenv test`
- Static check: `pnpm --filter @kanwas/execenv typecheck`
- Compile check: `pnpm --filter @kanwas/execenv build`
- For sync changes, validate with a live yjs-server/backend path because filesystem events, socket updates, uploads, and metadata refresh interact.

## Child DOX Index

No nested `AGENTS.md` yet.
