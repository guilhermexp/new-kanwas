# Kanwas CLI DOX

## Purpose

`@kanwas/cli` is the command-line workspace sync tool. It authenticates through the backend/frontend, binds local directories to Kanwas workspaces, pulls workspace state to files, pushes local filesystem changes back through Yjs, imports markdown, and lists or cleans workspaces.

## Ownership

- `src/index.ts` owns the `kanwas` Commander program and command wiring.
- `src/commands/` owns `login`, `new`, `pull`, `push`, `import`, `workspaces`, `clean`, and the interactive selector.
- `src/config.ts` owns global auth config at `~/.kanwas/config.json` and local binding config at `.kanwas.json`.
- `src/connection.ts` owns Yjs socket token minting and `connectToWorkspace` setup for CLI clients.
- `src/fs-utils.ts` owns local filesystem walking, writing, hashing, ignore matching, and path traversal guards.
- `README.md` and `SKILL.md` document user and agent-facing CLI behavior.

## Local Contracts

- Published bin is `kanwas` from `dist/index.js`; keep the shebang/build output executable when changing bundling.
- Local `.kanwas.json` stores `workspaceId`, `workspaceName`, optional `snapshot`, and optional `ignore`; `pull` and `push` depend on this shape for three-way diff behavior.
- Global `~/.kanwas/config.json` requires `backendUrl`, `frontendUrl`, `yjsServerHost`, and `authToken`.
- `connect()` identifies itself as `clientKind: 'cli'` and must mint `/workspaces/:id/yjs-socket-token` before connecting to yjs-server.
- `pull`, `push`, `import`, and `clean` depend on `shared/server` for `workspaceToFilesystem`, `ContentConverter`, and `FilesystemSyncer`; do not replace the shared sync contract locally.
- CLI sync ignores hidden files and `.kanwas.json`; default ignore also skips `metadata.yaml`.
- `clean` is destructive for remote workspace files. Keep confirmation behavior unless a user explicitly asks for `--force`.

## Work Guidance

- Dev: `pnpm --filter @kanwas/cli dev`
- Build: `pnpm --filter @kanwas/cli build`
- Typecheck: `pnpm --filter @kanwas/cli typecheck`

## Verification

- Static check: `pnpm --filter @kanwas/cli typecheck`
- Bundle check: `pnpm --filter @kanwas/cli build`
- There is no package test script here yet; for sync changes, use a real or fixture workspace and verify `pull`/`push` behavior end to end.

## Child DOX Index

No nested `AGENTS.md` yet.
