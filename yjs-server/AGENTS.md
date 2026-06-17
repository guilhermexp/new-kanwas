# Kanwas Yjs Server DOX

## Purpose

Socket.IO + Yjs realtime collaboration service for Kanwas workspaces and notes. It loads workspace CRDT documents from storage, bootstraps clients, applies updates/awareness, persists root and note documents, and notifies backend when collaborative documents change.

## Ownership

- `src/index.ts` owns process startup, config loading, Sentry init, server start, and signal shutdown.
- `src/server.ts` owns HTTP and Socket.IO server creation, ping/cors/transports, request handling, socket connection handling, and clean shutdown.
- `src/room-manager.ts` owns workspace room lifecycle.
- `src/room.ts` owns workspace/note `Y.Doc` state, bootstrapping, socket subscriptions, updates, awareness, note bundles, persistence, reloads, and backend notifications.
- `src/room-types.ts`, `src/protocol.ts`, and `src/sync-v2.ts` own wire-level payload/event contracts.
- `src/storage.ts` and `src/migrating-document-store.ts` own filesystem/R2 document persistence and legacy migration.
- `src/document-share-resolver.ts` and `src/socket-token-verifier.ts` own access control inputs from backend.

## Local Contracts

- Socket event names are defined in `src/protocol.ts`: `yjs:bootstrap`, `yjs:update`, `yjs:create-note-bundle`, `yjs:awareness`, `yjs:awareness-subscription`, and `yjs:reload`.
- Wire payload types come from `shared/workspace-sync-types`; keep yjs-server, frontend, cli, and execenv aligned when changing bootstrap/update/awareness payloads.
- Root document validation uses `assertValidWorkspaceRoot` from `shared/canvas-tree`. Invalid root updates can disconnect or be rejected.
- Attached note docs must have `guid === noteId`, valid note metadata, and valid BlockNote `content` fragments. Preserve `ensureNoteDocInitialized` and `validateLoadedNoteDoc` semantics.
- Storage keys are versioned under `v3/workspaces`; migration still reads v2/legacy documents. Do not rewrite storage layout without a migration path.
- `BACKEND_API_SECRET` is required. Backend notifications and shared-link resolution are enabled only when `BACKEND_URL` is present.
- Local filesystem storage uses `YJS_SERVER_STORAGE_DRIVER=fs` and `YJS_SERVER_STORE_DIR`; production default resolves to R2 unless configured otherwise.

## Work Guidance

- Dev: `pnpm --filter kanwas-yjs-server dev`
- Build: `pnpm --filter kanwas-yjs-server build`
- Start built server: `pnpm --filter kanwas-yjs-server start`
- Tests: `pnpm --filter kanwas-yjs-server test`
- Idle room measurement: `pnpm --filter kanwas-yjs-server measure:idle-room`

## Verification

- Unit/integration coverage: `pnpm --filter kanwas-yjs-server test`
- Compile check: `pnpm --filter kanwas-yjs-server build`
- For persistence or socket protocol changes, run a live stack and confirm bootstrap, update, reload, and stored-document behavior with real frontend/CLI clients.

## Child DOX Index

No nested `AGENTS.md` yet.
