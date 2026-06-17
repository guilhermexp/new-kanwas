# Kanwas Shared DOX

## Purpose

Cross-package contract library for Kanwas workspace types, Yjs/BlockNote note docs, socket providers, filesystem conversion/sync, document shares, path mapping, skills parsing, audit fields, layout constants, and execution/LLM config helpers.

## Ownership

- `src/index.ts` owns browser-safe public exports for frontend, backend, yjs-server, cli, and execenv consumers.
- `src/server.ts` owns Node-only exports for filesystem conversion, server-side BlockNote utilities, binary handling, and filesystem sync.
- `src/types.ts` owns canonical workspace, canvas, node, group, section, file, and audit data types.
- `src/workspace/` owns Yjs workspace clients/providers, note subdoc contracts, bootstrap/snapshot payloads, filesystem conversion, path mapping, tree formatting, and validation.
- `src/skills/` owns skill parser, validator, and shared skill types.
- `tests/` owns unit and integration coverage for workspace conversion, sync, providers, skills, and config.

## Local Contracts

- Treat this package as a contract. Changes can affect backend, frontend, yjs-server, cli, and execenv at once.
- Only import through package exports declared in `package.json`. Do not make consumers depend on unpublished `src/*` paths.
- `shared` root exports are browser-safe. `shared/server` is Node-only and must not be imported by frontend code because it pulls server BlockNote/jsdom/Buffer-oriented dependencies.
- `src/workspace/note-doc.ts` defines attached note subdocs: notes live under the root doc `notes` map, `guid` must match note id, `meta` must include schema/content kind, and BlockNote content lives under the `content` XML fragment.
- `src/workspace/workspace-sync-types.ts` defines bootstrap/update/awareness payloads shared by yjs-server and clients.
- `src/workspace/workspace-content-store.ts` copies BlockNote fragments instead of replacing document identity. Preserve clone semantics and transactions when changing collaborative content paths.
- `src/workspace/filesystem-syncer.ts`, `src/workspace/converter.ts`, and `src/workspace/path-mapper.ts` are the CLI/execenv filesystem sync contract.
- Package exports include subpaths such as `./workspace-provider`, `./note-provider`, `./note-doc`, `./workspace-sync-types`, `./server`, `./constants`, `./canvas-tree`, `./skills`, `./llm-config`, and `./execution-config`; update `package.json#exports` and tests together.

## Work Guidance

- Dev/watch TypeScript: `pnpm --filter shared dev`
- Build: `pnpm --filter shared build`
- Tests: `pnpm --filter shared test`
- Watch tests: `pnpm --filter shared test:watch`

## Verification

- Contract tests: `pnpm --filter shared test`
- Compile check: `pnpm --filter shared build`
- For export or payload changes, also run the affected consumer checks in backend, frontend, yjs-server, cli, or execenv.

## Child DOX Index

No nested `AGENTS.md` yet.
