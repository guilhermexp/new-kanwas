# Kanwas CLI

Sync a [Kanwas](https://kanwas.ai) workspace with your local filesystem from the command line.

Use it to edit notes in your editor of choice, bulk-import markdown you already have on disk, or script workspace access from CI or another agent.

## Install

```bash
npm install -g @kanwas/cli
```

Requires Node.js 22+.

## Authenticate

```bash
kanwas login
```

Opens a browser tab to authorize the CLI. Auth is stored globally in `~/.kanwas/config.json` and reused across all commands.

## Edit a workspace locally

```bash
mkdir my-workspace && cd my-workspace
kanwas new "My Workspace" # create a workspace and bind this directory
# or:
kanwas pull               # interactive picker, downloads files into the current directory
# ...edit files in your editor...
kanwas push               # uploads local changes back
```

After the first `pull`, the directory is bound to that workspace via `.kanwas.json`. Subsequent `pull` / `push` reuse it automatically.

`push` does a three-way diff against the snapshot from the last `pull`. Files modified both locally and remotely surface as conflicts and prompt before overwriting.

## Import markdown from disk

```bash
kanwas import ./notes                       # interactive workspace picker
kanwas import ./notes --name "My Workspace" # non-interactive, by name
kanwas import ./intro.md --id <uuid>        # single file, by ID
kanwas import ./notes --dest research       # place imports under a subfolder
kanwas import ./notes --overwrite           # replace files that already exist
```

Walks the source path, picks up every `.md` file (other files are skipped and reported), preserves directory structure, and creates the files in the target workspace. Existing files are skipped unless `--overwrite` is set.

## List / script

```bash
kanwas workspaces             # list workspaces
kanwas workspaces --json      # JSON output for scripting
kanwas new "QA Workspace"     # create and bind a new workspace
kanwas pull --id <uuid>       # non-interactive: pin to a specific workspace
kanwas pull --name "<name>"   # non-interactive: by exact name
```

All commands accept `--id` or `--name` to skip the interactive picker, which makes them safe to use from CI or wrapping agents.

## Commands

| Command                | Purpose                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `kanwas login`         | Browser-based auth                                                        |
| `kanwas new <name>`    | Create a workspace and bind the current directory                         |
| `kanwas workspaces`    | List workspaces (`--json` for scripting)                                  |
| `kanwas pull`          | Download workspace files to the current directory                         |
| `kanwas push`          | Upload local edits back to the workspace                                  |
| `kanwas import <path>` | Import all `.md` files from a file or folder (`--dest`, `--overwrite`)    |
| `kanwas clean`         | Delete all remote files in the bound workspace (`--force` to skip prompt) |

Use `kanwas <command> --help` for full option listings.

## How sync works

- A workspace is a tree of canvases (directories) and nodes (files). Markdown notes live as `.md` files inside canvas directories.
- Checklist, Kanban, Sketch, Text, Link, and Sticky nodes sync as typed YAML files next to markdown notes.
- Image, audio, video, and generic file nodes sync as native binary files. Video files currently support `.mp4`, `.mov`, `.webm`, `.m4v`, and `.ogv`.
- `pull` materializes the workspace tree as files on disk and writes a `.kanwas.json` that records the bound workspace ID and a content-hash snapshot.
- `push` walks the local directory, compares it to the snapshot and the current remote, and applies a `create` / `update` / `delete` for each changed file.
- `import` is a one-shot — it does not create or update `.kanwas.json` and does not track the imported files for later sync. Use it to seed a workspace from existing markdown.
- `kanwas pull` after `kanwas import` will materialize the imported files and start tracking them.

## Typed node files

Checklist files use the `.checklist.yaml` suffix:

```yaml
items:
  - id: item-1
    text: Confirm requirements
    checked: true
    depth: 0
accentColor: '#22c55e'
```

Kanban files use the `.kanban.yaml` suffix:

```yaml
fields:
  - id: priority
    name: Priority
    type: select
    visible: true
    options:
      - id: high
        label: High
        color: '#ef4444'
columns:
  - id: todo
    title: To do
    workflowState: todo
    tasks:
      - id: task-1
        text: Create task from CLI
        checked: false
        assigneeName: admin
        fields:
          priority: high
        dependencies:
          - taskId: task-0
            relationType: blocked-by
            title: Previous task
```

Sketch files use the `.sketch.yaml` suffix and persist Excalidraw data plus SVG previews:

```yaml
excalidrawElements: []
excalidrawFiles: {}
excalidrawSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
```

Video nodes are regular video files on disk:

```text
demo-reel.mp4
```

## Use with Claude Code and other coding agents

This package ships a [`SKILL.md`](./SKILL.md) tuned for coding agents (when to use the CLI, non-interactive flags, pitfalls). To install it as a Claude Code skill:

```bash
mkdir -p ~/.claude/skills/kanwas-cli && curl -sL https://raw.githubusercontent.com/kanwas-ai/kanwas/master/cli/SKILL.md -o ~/.claude/skills/kanwas-cli/SKILL.md
```

Use `.claude/skills/kanwas-cli/SKILL.md` instead of the home-dir path if you want it scoped to a single project.

## License

Apache 2.0. Source: [github.com/kanwas-ai/kanwas](https://github.com/kanwas-ai/kanwas/tree/master/cli).
