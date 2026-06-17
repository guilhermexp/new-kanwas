# Kanwas — Root AGENTS.md

Multiplayer workspace for AI work: a shared context board where a team and an AI agent collaborate over the same documents/evidence, with the agent's tool calls streaming into one timeline. pnpm monorepo, TypeScript throughout.

## Navigation map (domains)

| Path                           | Domain                         | Stack                                                       |
| ------------------------------ | ------------------------------ | ----------------------------------------------------------- |
| `backend/`                     | API + AI agent + persistence   | AdonisJS 6, Lucid/Postgres, Redis, AI SDK, Claude Agent SDK |
| `frontend/`                    | Canvas + editor UI             | Vite + React + TS, BlockNote, Excalidraw, Tailwind v4       |
| `yjs-server/`                  | Realtime collaboration backend | socket.io, Yjs, ywasm                                       |
| `cli/` (`@kanwas/cli`)         | Workspace ↔ filesystem sync    | commander, tsup, Yjs                                        |
| `shared/`                      | Cross-package lib (contract)   | BlockNote, Yjs, valtio-y, remark                            |
| `execenv/` (`@kanwas/execenv`) | Execution sandbox              | chokidar, diff3, ws                                         |

## Commands (root)

- Format all: `pnpm format` · per-package lint/typecheck: `pnpm --filter <pkg> lint|typecheck`
- Full stack: `docker-compose --profile app up` → http://localhost:5173
- Per-package dev: `pnpm --filter <pkg> dev`

## Repo-wide rules

- **Yjs/BlockNote is load-bearing** — clone semantics + transactions matter; read `docs/SYSTEM_OVERVIEW.md` before editing collaborative doc/editor code. `@blocknote/core@0.46.0` is patched + overridden (`patches/`, root `pnpm.overrides`); don't bump casually.
- `shared/` is a contract: changes ripple to backend, yjs-server, cli, execenv.
- Tailwind v4: `@theme inline` + CSS vars, no `tailwind.config`, no `@apply`.
- Default branch `master`. Work on current branch; don't auto-create branches. `pnpm format` + lint before PR.

## DOX Framework

- Este repo usa DOX: AGENTS.md hierárquico, 1 por domínio/pasta durável. Cada AGENTS.md é contrato vinculante da sua subárvore.
- DOX é o eixo ESPAÇO (onde o código mora, como editar aqui). O eixo TEMPO (o que mudar, capability nova/breaking) é OpenSpec — antes de mudar comportamento, ver `openspec/` e seguir `openspec/project.md`. DOX não reescreve as rules do OpenSpec.

### Read Before Editing

1. Ler este AGENTS.md (raiz) + identificar cada path que vai tocar.
2. Caminhar da raiz até cada alvo, lendo todo AGENTS.md no caminho (Child DOX Index aponta o próximo).
3. Doc mais próximo controla detalhe local; pais controlam regra repo-wide. Em conflito, o mais próximo vence no detalhe — nenhum filho enfraquece DOX nem OpenSpec.
4. Não confiar em memória: re-ler a cadeia DOX na sessão atual antes de editar. Fazer a edição MÍNIMA no lugar certo (não duplicar função, não criar helper novo se dá pra estender).

### Update After Editing (DOX pass — obrigatório no closeout)

- Toda mudança significativa: atualizar o AGENTS.md dono mais próximo + pais afetados + Child DOX Index. Remover texto stale na hora.
- Atualizar quando muda: propósito, escopo, ownership, estrutura durável, contratos, workflow, inputs/outputs/permissões/constraints, preferência durável do usuário, ou criação/move/rename de AGENTS.md.
- Mudança de comportamento de capability → também rodar o ciclo OpenSpec (validate → archive).

### Child Doc Shape

Criar AGENTS.md filho quando a pasta vira boundary durável com regra própria. Seções (vazias se não há padrão ainda):

- **Purpose** · **Ownership** · **Local Contracts** · **Work Guidance** · **Verification** · **Child DOX Index**

### Closeout

1. Re-checar paths mudados contra a cadeia DOX.
2. Atualizar docs donos + pais/filhos afetados + cada Child DOX Index.
3. Remover texto stale/contraditório.
4. Rodar verificação existente (testes/lint) + ciclo OpenSpec se mudou comportamento.

## Child DOX Index

Workspace domain AGENTS.md initialized by doc-index scan:

- [x] `backend/AGENTS.md`
- [x] `frontend/AGENTS.md`
- [x] `yjs-server/AGENTS.md`
- [x] `cli/AGENTS.md`
- [x] `shared/AGENTS.md`
- [x] `execenv/AGENTS.md`
