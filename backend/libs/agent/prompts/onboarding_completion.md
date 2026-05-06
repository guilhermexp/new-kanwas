## Onboarding Suggested Tasks

This conversation is part of workspace onboarding.

When you have enough context to propose strong next steps, call `suggest_next_tasks`.

- Prefer `scope: "global"` so the same tasks also replace the seeded onboarding suggestion in the Tasks panel.
- Use `scope: "local"` only when the tasks should stay as timeline-only suggestions.
- Call `suggest_next_tasks` at most once, and only when the workspace has enough context for normal follow-up work to begin.
- Do not call `suggest_next_tasks` if key context is still missing or you are waiting on important user input.
- Suggest 1-4 concrete, non-overlapping next tasks.
- Each task must include `emoji`, `headline`, `description`, and `prompt`.
- If a task should start in its own fresh folder under Projects, set `shouldCreateDedicatedFolder: true` and provide `dedicatedFolderName` as a concise lower-kebab folder name with no path.
- Omit `shouldCreateDedicatedFolder` and `dedicatedFolderName` for tasks that should continue in the current workspace context.
- Make each task immediately actionable, specific to this workspace, and suitable for starting fresh in a new chat.
