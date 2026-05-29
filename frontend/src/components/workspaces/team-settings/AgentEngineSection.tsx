import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EXECUTION_ENGINE_PRESETS, DEFAULT_EXECUTION_ENGINE } from 'shared/execution-config'
import type { ExecutionEngine } from 'shared/execution-config'
import { getUserConfig, updateUserConfig } from '@/api/userConfig'

interface AgentEngineSectionProps {
  isOpen: boolean
}

/**
 * Lets the user pick which agent runs their tasks (Codex / Claude Code /
 * built-in). The choice is stored per-user and applied at invocation, so it
 * lives here in settings rather than in the chat composer.
 */
export function AgentEngineSection({ isOpen }: AgentEngineSectionProps) {
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['user-config'],
    queryFn: getUserConfig,
    enabled: isOpen,
  })

  const mutation = useMutation({
    mutationFn: (engine: ExecutionEngine) => updateUserConfig({ executionEngine: engine }),
    onSuccess: (result) => {
      queryClient.setQueryData(['user-config'], result)
    },
  })

  const selected = data?.config.executionEngine ?? DEFAULT_EXECUTION_ENGINE

  return (
    <section className="rounded-xl border border-outline bg-editor/60 p-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">Agent</span>

      {isLoading ? (
        <div className="mt-2 h-9 rounded-md bg-block-highlight animate-pulse" />
      ) : isError ? (
        <div className="mt-2 rounded-lg border border-status-error/30 bg-status-error/5 p-3 text-xs text-status-error space-y-2">
          <p>Unable to load agent settings.</p>
          <button className="underline" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {EXECUTION_ENGINE_PRESETS.map((preset) => {
            const isActive = preset.id === selected
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => !isActive && mutation.mutate(preset.id)}
                disabled={mutation.isPending}
                aria-pressed={isActive}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition disabled:opacity-60 ${
                  isActive
                    ? 'border-focused-content bg-block-highlight text-foreground'
                    : 'border-outline bg-canvas text-foreground hover:border-focused-content/50'
                }`}
              >
                <span>
                  <span className="font-medium">{preset.label}</span>
                  <span className="block text-[11px] text-foreground-muted">{preset.description}</span>
                </span>
                {isActive ? <span className="text-focused-content">✓</span> : null}
              </button>
            )
          })}
          <p className="text-[11px] text-foreground-muted">
            Applies to new tasks. CLI agents (Codex / Claude Code) use your local subscription login.
          </p>
        </div>
      )}
    </section>
  )
}
