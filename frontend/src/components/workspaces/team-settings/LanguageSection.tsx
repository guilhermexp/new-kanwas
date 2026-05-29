import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, isAppLanguage, setAppLanguage, type AppLanguage } from '@/i18n'
import { getUserConfig, updateUserConfig } from '@/api/userConfig'

interface LanguageSectionProps {
  isOpen: boolean
}

/**
 * Lets the user pick the interface language. The choice persists per-user and
 * is applied immediately (and to future loads) via `setAppLanguage`.
 */
export function LanguageSection({ isOpen }: LanguageSectionProps) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['user-config'],
    queryFn: getUserConfig,
    enabled: isOpen,
  })

  const mutation = useMutation({
    mutationFn: (language: AppLanguage) => updateUserConfig({ language }),
    onMutate: (language) => {
      // Apply instantly for snappy UX; the persisted value confirms it.
      setAppLanguage(language)
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['user-config'], result)
    },
  })

  // Fall back to the active runtime language (set by the detector) so the
  // selection matches what the user actually sees before they've saved a choice.
  const activeLanguage = isAppLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE
  const selected = data?.config.language ?? activeLanguage

  return (
    <section className="rounded-xl border border-outline bg-editor/60 p-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
        {t('settings.language')}
      </span>

      {isLoading ? (
        <div className="mt-2 h-9 rounded-md bg-block-highlight animate-pulse" />
      ) : isError ? (
        <div className="mt-2 rounded-lg border border-status-error/30 bg-status-error/5 p-3 text-xs text-status-error space-y-2">
          <p>{t('settings.languageLoadError')}</p>
          <button className="underline" onClick={() => void refetch()}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {SUPPORTED_LANGUAGES.map((language) => {
            const isActive = language === selected
            return (
              <button
                key={language}
                type="button"
                onClick={() => !isActive && mutation.mutate(language)}
                disabled={mutation.isPending}
                aria-pressed={isActive}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition disabled:opacity-60 ${
                  isActive
                    ? 'border-focused-content bg-block-highlight text-foreground'
                    : 'border-outline bg-canvas text-foreground hover:border-focused-content/50'
                }`}
              >
                <span className="font-medium">{t(`languages.${language}`)}</span>
                {isActive ? <span className="text-focused-content">✓</span> : null}
              </button>
            )
          })}
          <p className="text-[11px] text-foreground-muted">{t('settings.languageNote')}</p>
        </div>
      )}
    </section>
  )
}
