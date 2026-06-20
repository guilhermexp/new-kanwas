import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EXECUTION_ENGINE_PRESETS, DEFAULT_EXECUTION_ENGINE } from 'shared/execution-config'
import type { ExecutionEnginePresetId } from 'shared/execution-config'
import {
  disconnectCodexAuth,
  getCodexAuthStatus,
  pollCodexAuth,
  startCodexAuth,
  type CodexAuthStartResult,
} from '@/api/codexAuth'
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
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['user-config'],
    queryFn: getUserConfig,
    enabled: isOpen,
  })

  const mutation = useMutation({
    mutationFn: (engine: ExecutionEnginePresetId) => updateUserConfig({ executionEngine: engine }),
    onSuccess: (result) => {
      queryClient.setQueryData(['user-config'], result)
    },
  })

  const selected = data?.config.executionEngine ?? DEFAULT_EXECUTION_ENGINE
  const codexStatus = useQuery({
    queryKey: ['codex-auth-status'],
    queryFn: getCodexAuthStatus,
    enabled: isOpen,
  })
  // Memoised so the child's poll `useEffect` is not torn down and recreated on
  // every unrelated re-render of this settings section.
  const refetchCodexStatus = codexStatus.refetch
  const handleRefreshCodex = useCallback(() => void refetchCodexStatus(), [refetchCodexStatus])

  return (
    <section className="rounded-xl border border-outline bg-editor/60 p-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
        {t('settings.agent')}
      </span>

      {isLoading ? (
        <div className="mt-2 h-9 rounded-md bg-block-highlight animate-pulse" />
      ) : isError ? (
        <div className="mt-2 rounded-lg border border-status-error/30 bg-status-error/5 p-3 text-xs text-status-error space-y-2">
          <p>{t('settings.agentLoadError')}</p>
          <button className="underline" onClick={() => void refetch()}>
            {t('common.retry')}
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
          {selected === 'codex' ? (
            <CodexAccountConnection
              status={codexStatus.data}
              isLoading={codexStatus.isLoading}
              onRefresh={handleRefreshCodex}
            />
          ) : null}
          <p className="text-[11px] text-foreground-muted">{t('settings.agentNote')}</p>
        </div>
      )}
    </section>
  )
}

function CodexAccountConnection({
  status,
  isLoading,
  onRefresh,
}: {
  status?: { connected: boolean; lastRefresh?: string }
  isLoading: boolean
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const [login, setLogin] = useState<CodexAuthStartResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  useEffect(() => {
    if (!login) return

    const expiresAtMs = new Date(login.expiresAt).getTime()
    let cancelled = false
    const poll = async () => {
      if (Date.now() >= expiresAtMs) {
        if (!cancelled) {
          setLogin(null)
          setError(t('settings.codexAuthExpired'))
        }
        return
      }
      try {
        const result = await pollCodexAuth(login.sessionId)
        if (cancelled) return
        if (result.status === 'connected') {
          setLogin(null)
          onRefresh()
          return
        }
        if (typeof result.intervalSeconds === 'number') {
          setLogin((current) =>
            current?.sessionId === login.sessionId ? { ...current, intervalSeconds: result.intervalSeconds! } : current
          )
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : t('settings.codexAuthError'))
        }
      }
    }

    const interval = window.setInterval(() => void poll(), Math.max(3, login.intervalSeconds) * 1000)
    void poll()
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [login, onRefresh, t])

  const handleConnect = async () => {
    setError(null)
    setIsStarting(true)
    try {
      const result = await startCodexAuth()
      setLogin(result)
      window.open(result.verificationUri, '_blank', 'noopener,noreferrer')
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : t('settings.codexAuthError'))
    } finally {
      setIsStarting(false)
    }
  }

  const handleDisconnect = async () => {
    setError(null)
    setIsDisconnecting(true)
    try {
      await disconnectCodexAuth()
      setLogin(null)
      onRefresh()
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : t('settings.codexAuthError'))
    } finally {
      setIsDisconnecting(false)
    }
  }

  const connected = Boolean(status?.connected)

  return (
    <div className="rounded-lg border border-outline bg-canvas p-3 text-xs text-foreground">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-medium">
            <span>{t('settings.codexAuthTitle')}</span>
            {connected ? (
              <span className="rounded-full border border-outline bg-block-highlight px-2 py-0.5 text-[11px] text-foreground-muted">
                ✓ {t('settings.connected')}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-foreground-muted">{t('settings.codexAuthDescription')}</p>
        </div>
        {connected ? (
          <button
            type="button"
            className="rounded-md border border-outline px-2 py-1 text-foreground-muted hover:text-foreground disabled:opacity-60"
            disabled={isDisconnecting}
            onClick={() => void handleDisconnect()}
            aria-label={t('settings.disconnect')}
          >
            <i className="fa-solid fa-trash" />
          </button>
        ) : (
          <button
            type="button"
            className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-60"
            disabled={isLoading || isStarting}
            onClick={() => void handleConnect()}
          >
            {isStarting ? t('settings.connecting') : t('settings.connectAccount')}
          </button>
        )}
      </div>

      {login ? (
        <div className="mt-3 rounded-md border border-focused-content/40 bg-block-highlight p-3">
          <p className="text-[11px] text-foreground-muted">{t('settings.codexAuthCodePrompt')}</p>
          <div className="mt-2 flex flex-wrap gap-1 font-mono text-base tracking-[0.12em] text-foreground">
            {login.userCode.split('').map((char, index) => (
              <span key={`${char}-${index}`} className="rounded border border-outline px-1.5 py-1">
                {char}
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-foreground-muted">
            <button
              type="button"
              className="underline"
              onClick={() => window.open(login.verificationUri, '_blank', 'noopener,noreferrer')}
            >
              {t('settings.reopenVerificationPage')}
            </button>
            <span>{t('settings.waitingForAuthorization')}</span>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[11px] text-status-error">{error}</p> : null}
    </div>
  )
}
